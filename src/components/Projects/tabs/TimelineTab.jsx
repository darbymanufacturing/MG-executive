import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../../../context/ProjectContext.jsx';
import { computeCPM } from '../../../utils/criticalPath.js';
import { STATUS_CONFIG } from '../constants.js';
import styles from './TimelineTab.module.css';

const PHASE_COLORS = {
  done:       '#00C896',
  inProgress: '#F5A623',
  notStarted: '#3a3a4a',
};

const ROW_HEIGHT   = 52;
const LABEL_WIDTH  = 180;
const PADDING      = 24;
const HEADER_H     = 40;
const PHASE_H      = 10;
const PROJECT_BAR_H = 14;
const BAR_OFFSET_Y = (ROW_HEIGHT - PROJECT_BAR_H) / 2;

function parseDateSafe(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/** Build an array of tick dates for the axis given zoom preset. */
function buildTicks(minDate, maxDate, zoom) {
  const ticks = [];
  const d = new Date(minDate);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  const end = new Date(maxDate);

  let step;
  if (zoom === '1M')      step = { months: 1, label: (d) => d.toLocaleString('default', { month: 'short', day: 'numeric' }) };
  else if (zoom === '3M') step = { months: 1, label: (d) => d.toLocaleString('default', { month: 'short', year: '2-digit' }) };
  else if (zoom === '6M') step = { months: 2, label: (d) => d.toLocaleString('default', { month: 'short', year: '2-digit' }) };
  else                    step = { months: 3, label: (d) => d.toLocaleString('default', { month: 'short', year: 'numeric' }) };

  while (d <= end) {
    ticks.push({ date: new Date(d), label: step.label(d) });
    d.setMonth(d.getMonth() + (step.months || 1));
  }
  return ticks;
}

/** Map a date to an X coordinate within the chart area. */
function dateToX(date, minTime, totalMs, chartW) {
  return ((date.getTime() - minTime) / totalMs) * chartW;
}

export default function TimelineTab() {
  const navigate = useNavigate();
  const { activeProjects } = useProjects();
  const [zoom, setZoom]       = useState('auto');
  const [showCPM, setShowCPM] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  // Per-project CPM data (only computed when CPM overlay is on)
  const cpmByProject = useMemo(() => {
    if (!showCPM) return {};
    const result = {};
    for (const p of activeProjects) {
      const cpm = computeCPM(p.phases || []);
      result[p._docId] = cpm;
    }
    return result;
  }, [activeProjects, showCPM]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Compute date range ────────────────────────────────────────────────────
  const { minDate, maxDate } = useMemo(() => {
    let min = null, max = null;
    for (const p of activeProjects) {
      const s = parseDateSafe(p.startDate);
      const e = parseDateSafe(p.targetDate);
      if (s && (!min || s < min)) min = s;
      if (e && (!max || e > max)) max = e;
      for (const ph of p.phases || []) {
        const pt = parseDateSafe(ph.targetDate);
        if (pt && (!max || pt > max)) max = pt;
      }
    }
    if (!min) min = new Date(today);
    if (!max) { max = new Date(today); max.setMonth(max.getMonth() + 6); }

    // Apply zoom preset
    if (zoom !== 'auto') {
      const months = zoom === '1M' ? 1 : zoom === '3M' ? 3 : zoom === '6M' ? 6 : 12;
      min = new Date(today);
      min.setDate(1);
      max = new Date(min);
      max.setMonth(max.getMonth() + months);
    } else {
      // Add 2-week padding
      min = new Date(min); min.setDate(min.getDate() - 14);
      max = new Date(max); max.setDate(max.getDate() + 14);
    }
    return { minDate: min, maxDate: max };
  }, [activeProjects, zoom, today]);

  const minTime  = minDate.getTime();
  const totalMs  = maxDate.getTime() - minTime;

  // SVG sizing
  const [chartW] = useState(900);
  const rows = activeProjects.length;
  const svgH = HEADER_H + rows * ROW_HEIGHT + PADDING;

  const ticks = useMemo(() => buildTicks(minDate, maxDate, zoom), [minDate, maxDate, zoom]);

  function x(date) { return LABEL_WIDTH + dateToX(date, minTime, totalMs, chartW); }
  function xSafe(str) {
    const d = parseDateSafe(str);
    return d ? x(d) : null;
  }

  // Clamp x to chart bounds
  function clamp(val) {
    return Math.max(LABEL_WIDTH, Math.min(LABEL_WIDTH + chartW, val));
  }

  const todayX = x(today);
  const todayInRange = today >= minDate && today <= maxDate;

  function handleMouseEnter(e, content) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, content });
  }

  return (
    <div className={styles.wrap}>
      {/* ── Controls ── */}
      <div className={styles.controls}>
        <span className={styles.heading}>Project Timeline</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className={styles.zoomGroup}>
            <span className={styles.zoomLabel}>Zoom:</span>
            {['1M','3M','6M','1Y','auto'].map((z) => (
              <button
                key={z}
                className={`${styles.zoomBtn} ${zoom === z ? styles.zoomBtnActive : ''}`}
                onClick={() => setZoom(z)}
              >
                {z === 'auto' ? 'Fit all' : z}
              </button>
            ))}
          </div>
          <button
            className={`${styles.zoomBtn} ${showCPM ? styles.zoomBtnActive : ''}`}
            style={{ borderColor: showCPM ? '#E84545' : undefined, background: showCPM ? '#E84545' : undefined }}
            onClick={() => setShowCPM((v) => !v)}
            title="Highlight critical path phases"
          >
            ⚠ Critical Path
          </button>
        </div>
      </div>

      {activeProjects.length === 0 ? (
        <div className={styles.empty}>No active projects to display.</div>
      ) : (
        <div className={styles.svgScroll}>
          <svg
            ref={svgRef}
            width={LABEL_WIDTH + chartW}
            height={svgH}
            className={styles.svg}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* ── Background alternating rows ── */}
            {activeProjects.map((_, i) => (
              <rect
                key={i}
                x={0}
                y={HEADER_H + i * ROW_HEIGHT}
                width={LABEL_WIDTH + chartW}
                height={ROW_HEIGHT}
                fill={i % 2 === 0 ? 'var(--color-surface-2)' : 'var(--color-surface)'}
              />
            ))}

            {/* ── Time axis ── */}
            {ticks.map((tick, i) => {
              const tx = x(tick.date);
              if (tx < LABEL_WIDTH || tx > LABEL_WIDTH + chartW) return null;
              return (
                <g key={i}>
                  <line x1={tx} y1={HEADER_H} x2={tx} y2={svgH} stroke="var(--color-border)" strokeWidth={1} />
                  <text x={tx + 4} y={HEADER_H - 6} fontSize={10} fill="var(--color-text-muted)" fontFamily="var(--font-body)">
                    {tick.label}
                  </text>
                </g>
              );
            })}

            {/* ── Today line ── */}
            {todayInRange && (
              <g>
                <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH} stroke="#C97D49" strokeWidth={2} strokeDasharray="4 3" />
                <text x={todayX + 4} y={HEADER_H - 6} fontSize={10} fill="#C97D49" fontFamily="var(--font-body)" fontWeight={600}>Today</text>
              </g>
            )}

            {/* ── Project rows ── */}
            {activeProjects.map((project, i) => {
              const rowY    = HEADER_H + i * ROW_HEIGHT;
              const startX  = xSafe(project.startDate);
              const endX    = xSafe(project.targetDate);
              const statusCfg = STATUS_CONFIG[project.effectiveStatus] || STATUS_CONFIG.onTrack;

              // Project bar
              let barX = startX ?? LABEL_WIDTH;
              let barW = endX ? endX - barX : 60;
              barX = clamp(barX);
              const barXEnd = clamp(endX ?? barX + 60);
              barW = Math.max(4, barXEnd - barX);

              const phases = project.phases || [];
              const donePhases = phases.filter((ph) => ph.status === 'done').length;
              const phasePct   = phases.length ? donePhases / phases.length : 0;

              return (
                <g key={project._docId}>
                  {/* Row label */}
                  <foreignObject x={4} y={rowY + 8} width={LABEL_WIDTH - 10} height={ROW_HEIGHT - 8}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusCfg.color, flexShrink: 0 }} />
                      <button
                        style={{ fontSize: 11, color: 'var(--color-text-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}
                        onClick={() => navigate(`/projects/${project._docId}`)}
                        title={project.name}
                      >
                        {project.name}
                      </button>
                    </div>
                  </foreignObject>

                  {/* Project bar */}
                  <rect
                    x={barX}
                    y={rowY + BAR_OFFSET_Y}
                    width={barW}
                    height={PROJECT_BAR_H}
                    fill={statusCfg.color}
                    rx={3}
                    opacity={0.25}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/projects/${project._docId}`)}
                    onMouseEnter={(e) => handleMouseEnter(e, `${project.name}\n${project.startDate || '?'} → ${project.targetDate || '?'}\n${Math.round(phasePct * 100)}% phases done`)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  {/* Progress fill */}
                  <rect
                    x={barX}
                    y={rowY + BAR_OFFSET_Y}
                    width={barW * phasePct}
                    height={PROJECT_BAR_H}
                    fill={statusCfg.color}
                    rx={3}
                    style={{ pointerEvents: 'none' }}
                  />

                  {/* Phase segments */}
                  {phases.map((ph) => {
                    if (!ph.targetDate) return null;
                    const px = xSafe(ph.targetDate);
                    if (!px) return null;
                    const cx = clamp(px);
                    const py = rowY + BAR_OFFSET_Y - PHASE_H - 2;
                    const cpmPhase = showCPM ? (cpmByProject[project._docId] || []).find((c) => c.id === ph.id) : null;
                    const phColor = cpmPhase?.critical ? '#E84545'
                      : PHASE_COLORS[ph.status] || PHASE_COLORS.notStarted;
                    const s = cpmPhase?.critical ? 7 : 5;
                    const floatInfo = cpmPhase ? `\nFloat: ${cpmPhase.float}d${cpmPhase.critical ? ' ⚠ CRITICAL' : ''}` : '';
                    return (
                      <g key={ph.id}>
                        <polygon
                          points={`${cx},${py - s} ${cx + s},${py} ${cx},${py + s} ${cx - s},${py}`}
                          fill={phColor}
                          opacity={0.9}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => handleMouseEnter(e, `Phase ${ph.number}: ${ph.name}\nStatus: ${ph.status}\nTarget: ${ph.targetDate}${floatInfo}`)}
                          onMouseLeave={() => setTooltip(null)}
                          onClick={() => navigate(`/projects/${project._docId}`)}
                        />
                        {cpmPhase?.critical && (
                          <circle cx={cx} cy={py} r={s + 4} fill="none" stroke="#E84545" strokeWidth={1.5} opacity={0.5} />
                        )}
                      </g>
                    );
                  })}

                  {/* Next-action marker (star) */}
                  {project.nextAction?.dueDate && (() => {
                    const nx = xSafe(project.nextAction.dueDate);
                    if (!nx) return null;
                    const cx = clamp(nx);
                    const cy = rowY + ROW_HEIGHT - 10;
                    return (
                      <text
                        key="na"
                        x={cx - 5}
                        y={cy}
                        fontSize={11}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => handleMouseEnter(e, `Next action: ${project.nextAction.text}\nDue: ${project.nextAction.dueDate}`)}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        ★
                      </text>
                    );
                  })()}

                  {/* Active blocker ticks */}
                  {(project.blockers || []).filter((b) => !b.resolved && b.addedAt).map((b) => {
                    const bx = xSafe(b.addedAt);
                    if (!bx) return null;
                    const cx = clamp(bx);
                    return (
                      <line
                        key={b.id}
                        x1={cx} y1={rowY + 4}
                        x2={cx} y2={rowY + ROW_HEIGHT - 4}
                        stroke="#E84545"
                        strokeWidth={2}
                        strokeDasharray="3 2"
                        opacity={0.7}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => handleMouseEnter(e, `Blocker: ${b.text}\nType: ${b.type}`)}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })}

                  {/* Linked-project connector (dashed) */}
                  {(project.linkedProjectIds || []).map((linkedId) => {
                    const linkedIdx = activeProjects.findIndex((p) => p._docId === linkedId);
                    if (linkedIdx === -1 || linkedIdx <= i) return null;
                    const linkedProject = activeProjects[linkedIdx];
                    const sx = xSafe(project.targetDate);
                    const ex = xSafe(linkedProject.startDate);
                    if (!sx || !ex) return null;
                    const sy = rowY + BAR_OFFSET_Y + PROJECT_BAR_H / 2;
                    const ey = HEADER_H + linkedIdx * ROW_HEIGHT + BAR_OFFSET_Y + PROJECT_BAR_H / 2;
                    return (
                      <g key={linkedId}>
                        <line
                          x1={clamp(sx)} y1={sy}
                          x2={clamp(ex)} y2={ey}
                          stroke="var(--color-primary-light)"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          opacity={0.6}
                        />
                        <circle cx={clamp(ex)} cy={ey} r={3} fill="var(--color-primary-light)" opacity={0.7} />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* ── Row dividers ── */}
            {activeProjects.map((_, i) => (
              <line
                key={`div-${i}`}
                x1={0} y1={HEADER_H + (i + 1) * ROW_HEIGHT}
                x2={LABEL_WIDTH + chartW} y2={HEADER_H + (i + 1) * ROW_HEIGHT}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
            ))}

            {/* ── Label column separator ── */}
            <line x1={LABEL_WIDTH} y1={0} x2={LABEL_WIDTH} y2={svgH} stroke="var(--color-border)" strokeWidth={1} />
          </svg>

          {/* ── Tooltip ── */}
          {tooltip && (
            <div
              className={styles.tooltip}
              style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
            >
              {tooltip.content.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: PHASE_COLORS.done }} />Phase done</span>
        <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: PHASE_COLORS.inProgress }} />In progress</span>
        <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: PHASE_COLORS.notStarted }} />Not started</span>
        <span className={styles.legendItem}><span style={{ color: '#C97D49', fontSize: 12, fontWeight: 700 }}>┊</span>Today</span>
        <span className={styles.legendItem}><span style={{ fontSize: 11 }}>★</span> Next action</span>
        <span className={styles.legendItem}><span style={{ color: '#E84545', fontSize: 12, fontWeight: 700 }}>┊</span>Blocker</span>
        <span className={styles.legendItem}><span style={{ borderBottom: '1.5px dashed var(--color-primary-light)', paddingRight: 12 }} />Linked project</span>
        {showCPM && <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#E84545' }} />Critical phase</span>}
      </div>
    </div>
  );
}
