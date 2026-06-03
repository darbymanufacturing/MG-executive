import { createContext, useContext, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

/**
 * FF-2 Phase B — founder-editable bank categorization rules (org-scoped).
 * Rule shape: { contains: string, category: string, priority: number }.
 * The engine (bankRulesEngine.buildRules) evaluates these BEFORE the built-in
 * defaults, so a custom rule overrides a keyword default but unmatched
 * descriptions still fall back to the built-ins. Plain `contains` — never regex.
 */
const RULES_COL = 'bankRules';
const BankRulesContext = createContext(null);

export function BankRulesProvider({ children }) {
  const { orgId } = useOrg();
  const { items, loading } = useOrgCollection(RULES_COL, { limit: 200 });

  const rules = useMemo(
    () => [...items].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [items],
  );

  const addRule = useCallback(async ({ contains, category, priority }) => {
    if (!orgId) throw new Error('addRule: no active org');
    const now = new Date().toISOString();
    const rule = {
      id: uuidv4(),
      contains: String(contains ?? '').trim(),
      category,
      priority: Number.isFinite(priority) ? priority : rules.length + 1,
      createdAt: now,
      updatedAt: now,
    };
    await orgWrite(RULES_COL, rule, { rethrow: true, errorMessage: 'Failed to save rule' });
  }, [orgId, rules.length]);

  const updateRule = useCallback(async (docId, patch) => {
    await orgUpdate(
      RULES_COL,
      docId,
      { ...patch, updatedAt: new Date().toISOString() },
      { rethrow: true, errorMessage: 'Failed to update rule' },
    );
  }, []);

  const deleteRule = useCallback(async (docId) => {
    await orgDelete(RULES_COL, docId, { rethrow: true, errorMessage: 'Failed to delete rule' });
  }, []);

  return (
    <BankRulesContext.Provider value={{ rules, loading, addRule, updateRule, deleteRule }}>
      {children}
    </BankRulesContext.Provider>
  );
}

export function useBankRules() {
  const ctx = useContext(BankRulesContext);
  if (!ctx) throw new Error('useBankRules must be used inside <BankRulesProvider>');
  return ctx;
}
