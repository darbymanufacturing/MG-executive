import { describe, test, expect } from 'vitest';
import { sanitizeCloudinaryUrl } from '../sanitizeCloudinaryUrl.js';

describe('sanitizeCloudinaryUrl', () => {
  test('returns the URL unchanged for a valid https://res.cloudinary.com/ URL', () => {
    const url = 'https://res.cloudinary.com/my-cloud/image/upload/v1234/repair_photos/foo.jpg';
    expect(sanitizeCloudinaryUrl(url)).toBe(url);
  });

  test('returns null for an http:// Cloudinary URL (not https)', () => {
    const url = 'http://res.cloudinary.com/my-cloud/image/upload/v1234/repair_photos/foo.jpg';
    expect(sanitizeCloudinaryUrl(url)).toBeNull();
  });

  test('returns null for an arbitrary https URL with a different hostname', () => {
    const url = 'https://evil.example.com/malicious.html';
    expect(sanitizeCloudinaryUrl(url)).toBeNull();
  });

  test('returns null for a javascript: URI', () => {
    expect(sanitizeCloudinaryUrl('javascript:alert(1)')).toBeNull();
  });

  test('returns null for a data: URI', () => {
    expect(sanitizeCloudinaryUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(sanitizeCloudinaryUrl('')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(sanitizeCloudinaryUrl(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(sanitizeCloudinaryUrl(undefined)).toBeNull();
  });
});
