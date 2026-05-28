/**
 * src/utils/permissions.js
 * Omni role-based access control helpers.
 *
 * Roles (in ascending capability order):
 *   'crew'  — operational only; no financial data, only their assigned tickets
 *   'staff' — full ops access; no founder-private items (loans, sensitive decisions)
 *   'admin' — full access (founders, executives)
 *
 * Usage:
 *   import { canSee, canEdit, maskForRole } from '../utils/permissions';
 *   if (!canSee(user, 'revenue')) return null;
 *   const safeCost = maskForRole(costDoc, user, COST_FIELD_RULES);
 */

/* ─── Role hierarchy ─── */
const ROLE_LEVEL = { crew: 0, staff: 1, admin: 2 };

function level(user) {
  return ROLE_LEVEL[user?.role] ?? ROLE_LEVEL[user?.userRole] ?? -1;
}

/* ─── Resource-level visibility rules ─── */
const RESOURCE_RULES = {
  /* Financial — crew hidden, staff visible */
  revenue:      { minRead: 'staff', minWrite: 'admin' },
  costs:        { minRead: 'crew',  minWrite: 'staff'  }, /* costs visible to crew but amounts masked */
  investment:   { minRead: 'staff', minWrite: 'admin' },
  spr:          { minRead: 'staff', minWrite: 'admin' },

  /* Operational — all roles */
  tickets:      { minRead: 'crew',  minWrite: 'crew'   },
  parts:        { minRead: 'crew',  minWrite: 'staff'  },
  scooters:     { minRead: 'crew',  minWrite: 'staff'  },
  maintenance:  { minRead: 'crew',  minWrite: 'crew'   },

  /* Issues — crew cannot see (admin/staff only by default, visibility field overrides) */
  issues:       { minRead: 'staff', minWrite: 'staff'  },

  /* Projects — staff+ */
  projects:     { minRead: 'staff', minWrite: 'staff'  },

  /* Settings / admin actions */
  settings:     { minRead: 'admin', minWrite: 'admin'  },
  users:        { minRead: 'admin', minWrite: 'admin'  },
  notifications:{ minRead: 'crew',  minWrite: 'crew'   },
};

/**
 * canSee(user, resource) → boolean
 * Check if a user can VIEW a resource type.
 *
 * @param {object} user  — { role: 'admin'|'staff'|'crew' }
 * @param {string} resource — key from RESOURCE_RULES
 */
export function canSee(user, resource) {
  const rule = RESOURCE_RULES[resource];
  if (!rule) return true; /* unknown resources are visible by default */
  const userLevel = level(user);
  const minLevel = ROLE_LEVEL[rule.minRead] ?? 0;
  return userLevel >= minLevel;
}

/**
 * canEdit(user, resource) → boolean
 * Check if a user can WRITE/MODIFY a resource type.
 */
export function canEdit(user, resource) {
  const rule = RESOURCE_RULES[resource];
  if (!rule) return level(user) >= ROLE_LEVEL.staff; /* default: staff+ can edit */
  const userLevel = level(user);
  const minLevel = ROLE_LEVEL[rule.minWrite] ?? ROLE_LEVEL.staff;
  return userLevel >= minLevel;
}

/**
 * isAdmin(user) → boolean
 */
export function isAdmin(user) {
  return level(user) >= ROLE_LEVEL.admin;
}

/**
 * isStaff(user) → boolean (staff or admin)
 */
export function isStaff(user) {
  return level(user) >= ROLE_LEVEL.staff;
}

/**
 * isCrew(user) → boolean (any authenticated role)
 */
export function isCrew(user) {
  return level(user) >= ROLE_LEVEL.crew;
}

/**
 * maskForRole(doc, user, fieldRules) → masked doc
 * Remove or replace fields the user's role shouldn't see.
 *
 * fieldRules: { fieldName: { minRead: 'staff'|'admin', placeholder?: any } }
 *
 * Example:
 *   const COST_RULES = { amount: { minRead: 'staff', placeholder: null } };
 *   const safe = maskForRole(cost, user, COST_RULES);
 */
export function maskForRole(doc, user, fieldRules = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const userLevel = level(user);
  const masked = { ...doc };

  for (const [field, rule] of Object.entries(fieldRules)) {
    const minLevel = ROLE_LEVEL[rule.minRead] ?? ROLE_LEVEL.staff;
    if (userLevel < minLevel) {
      masked[field] = Object.prototype.hasOwnProperty.call(rule, 'placeholder')
        ? rule.placeholder
        : undefined;
    }
  }

  return masked;
}

/* ─── Pre-built field rule sets ─── */
export const COST_FIELD_RULES = {
  amount:    { minRead: 'staff', placeholder: null },
  frequency: { minRead: 'staff', placeholder: null },
};

export const REVENUE_FIELD_RULES = {
  revenue:   { minRead: 'staff', placeholder: null },
  trips:     { minRead: 'crew',  placeholder: null },
};

/**
 * filterIssuesByVisibility(issues, user) → filtered issues
 * An issue's `visibility` field ('admin'|'staff'|'crew') controls who sees it.
 */
export function filterIssuesByVisibility(issues = [], user) {
  const userLevel = level(user);
  return issues.filter(issue => {
    // #129 — default to 'staff' not 'admin'; matches default set at issue creation time
    const vis = issue.visibility || 'staff';
    const required = ROLE_LEVEL[vis] ?? ROLE_LEVEL.staff;
    return userLevel >= required;
  });
}
