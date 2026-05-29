/**
 * Minimal schema-based form validator. Zero deps. ~150 lines.
 *
 * Usage:
 *   import { validate } from './validateForm.js';
 *   import { costSchema } from './schemas/costSchema.js';
 *
 *   const { isValid, errors } = validate(formValues, costSchema);
 *   if (!isValid) { setErrors(errors); return; }
 *
 * Rule keys (per field):
 *   required:    true                                  must be present + non-empty
 *   type:        'string'|'number'|'date'|'boolean'|'array'  coerced type check
 *   min:         number                                numeric minimum
 *   max:         number                                numeric maximum
 *   minLength:   number                                string/array length
 *   maxLength:   number                                string/array length
 *   pattern:     RegExp                                string must match
 *   oneOf:       array                                 value must be in list
 *   after:       <field name>                          date is strictly after another field's date
 *   onOrAfter:   <field name>                          date is on or after another field's date
 *   custom:      (value, allValues) => string|null    returns error message or null
 *   label:       string                                friendly name in error messages (overrides auto-camelCase)
 *   requiredMessage / patternMessage / customMessage   override default copy for that rule
 */

export function validate(values, schema) {
  const errors = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = values?.[field];
    const label = rules.label || labelize(field);

    if (rules.required && isEmpty(value)) {
      errors[field] = rules.requiredMessage || `${label} is required`;
      continue;
    }

    if (isEmpty(value)) continue; // optional + empty → skip the rest

    if (rules.type) {
      const typeErr = checkType(value, rules.type, label);
      if (typeErr) { errors[field] = typeErr; continue; }
    }

    if (rules.minLength !== undefined && String(value).length < rules.minLength) {
      errors[field] = `${label} must be at least ${rules.minLength} character${rules.minLength === 1 ? '' : 's'}`;
      continue;
    }
    if (rules.maxLength !== undefined && String(value).length > rules.maxLength) {
      errors[field] = `${label} must be ${rules.maxLength} character${rules.maxLength === 1 ? '' : 's'} or fewer`;
      continue;
    }
    if (rules.min !== undefined && Number(value) < rules.min) {
      errors[field] = `${label} must be at least ${rules.min}`;
      continue;
    }
    if (rules.max !== undefined && Number(value) > rules.max) {
      errors[field] = `${label} must be at most ${rules.max}`;
      continue;
    }
    if (rules.pattern && !rules.pattern.test(String(value))) {
      errors[field] = rules.patternMessage || `${label} format is invalid`;
      continue;
    }
    if (rules.oneOf && !rules.oneOf.includes(value)) {
      errors[field] = `${label} must be one of: ${rules.oneOf.join(', ')}`;
      continue;
    }
    if (rules.after && values?.[rules.after]) {
      if (!isAfter(value, values[rules.after])) {
        const otherLabel = labelize(rules.after);
        errors[field] = `${label} must be after ${otherLabel}`;
        continue;
      }
    }
    if (rules.onOrAfter && values?.[rules.onOrAfter]) {
      if (!isOnOrAfter(value, values[rules.onOrAfter])) {
        const otherLabel = labelize(rules.onOrAfter);
        errors[field] = `${label} must be on or after ${otherLabel}`;
        continue;
      }
    }
    if (rules.custom) {
      const customErr = rules.custom(value, values);
      if (customErr) {
        errors[field] = rules.customMessage || customErr;
        continue;
      }
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function checkType(value, type, label) {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : `${label} must be text`;
    case 'number': {
      const n = Number(value);
      return !Number.isNaN(n) && Number.isFinite(n) ? null : `${label} must be a number`;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${label} must be true or false`;
    case 'date':
      return !Number.isNaN(new Date(value).getTime()) ? null : `${label} must be a valid date`;
    case 'array':
      return Array.isArray(value) ? null : `${label} must be a list`;
    default:
      return null;
  }
}

function isAfter(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  // #29 — unparseable dates must FAIL validation, not silently pass
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta > tb;
}

function isOnOrAfter(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  // #29 — unparseable dates must FAIL validation, not silently pass
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta >= tb;
}

function labelize(field) {
  return field
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convenience: returns first error message, or null. Useful for form-level banners. */
export function firstError(errors) {
  const keys = Object.keys(errors);
  return keys.length ? errors[keys[0]] : null;
}
