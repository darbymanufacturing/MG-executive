import { useState, useRef } from 'react';
import { Camera, Loader2, CheckCircle, X, AlertCircle } from 'lucide-react';
import { auth } from '../../lib/firebase.js';
import { useOrg } from '../../context/OrgContext.jsx';
import styles from './PhotoUpload.module.css';

export default function PhotoUpload({ sessionId, stepNumber, photoUrls = [], onChange }) {
  const { orgId } = useOrg();
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);
  const [inputKey, setInputKey]   = useState(0);
  const inputRef    = useRef(null);

  // Synchronous guard — React state updates are async so checking `uploading`
  // state inside handleFile can't stop a second iOS onChange that fires before
  // the first setUploading(true) has caused a re-render.
  const inFlightRef = useRef(false);
  // Mirror photoUrls into a ref so the closure always reads the latest list
  // even if the parent re-rendered while the upload was in progress.
  const urlsRef     = useRef(photoUrls);
  urlsRef.current   = photoUrls;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file || inFlightRef.current) return;

    inFlightRef.current = true;
    setUploading(true);
    setError(null);

    try {
      // Get Firebase ID token for the sign request
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired - please sign in again');

      const folder    = `repair-photos/${orgId}/${sessionId}`;
      const public_id = `${stepNumber}-${Date.now()}`;
      const context   = `sessionId=${sessionId}|stepNumber=${stepNumber}`;

      // Step 1 — obtain a server-side signature so we never embed the API secret
      // in the client bundle. Unauthenticated callers cannot reach this endpoint.
      const signRes = await fetch('/api/cloudinary-sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ folder, public_id, context }),
      });

      if (!signRes.ok) {
        const signBody = await signRes.text();
        throw new Error(`Sign request failed ${signRes.status}: ${signBody}`);
      }

      const { signature, api_key, timestamp, cloud_name } = await signRes.json();

      // Step 2 — signed direct upload to Cloudinary (no upload_preset needed)
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', api_key);
      form.append('timestamp', String(timestamp));
      form.append('signature', signature);
      form.append('folder', folder);
      form.append('public_id', public_id);
      form.append('context', context);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`,
        { method: 'POST', body: form }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cloudinary ${res.status}: ${body}`);
      }
      const data = await res.json();
      const url  = data.secure_url;
      // #103: use functional update to avoid stale appends; deduplicate in case of double-fire
      onChange((prev) => prev.includes(url) ? prev : [...prev, url]);
      // Remount the input only after a successful upload (not at the start).
      // On iOS WebKit, replacing the input element while a camera handoff is
      // still in progress fires another spurious onChange — doing it here,
      // after the upload is fully done, avoids that window.
      setInputKey((k) => k + 1);
    } catch (err) {
      console.error('Photo upload failed:', err);
      setError('Upload failed — tap to retry');
    } finally {
      inFlightRef.current = false;
      setUploading(false);
    }
  }

  async function removePhoto(idx) {
    const urlToRemove = photoUrls[idx];

    // Fire-and-forget Cloudinary deletion. We do not block the UI on this —
    // the local state is updated immediately and the server cleans up async.
    // Cloudinary secure_url format:
    //   https://res.cloudinary.com/<cloud>/image/upload[/<transformations>]/<public_id>.<ext>
    // Extract public_id by splitting on "/upload/" and stripping the extension,
    // then remove any version prefix ("v12345678/").
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired - please sign in again');

      const afterUpload  = urlToRemove.split('/upload/')[1] ?? '';
      const withoutExt   = afterUpload.replace(/\.[^/.]+$/, '');           // drop extension
      const publicId     = withoutExt.replace(/^v\d+\//, '');              // strip version prefix

      fetch('/api/cloudinary-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ publicId }),
      }).catch((err) => console.error('Cloudinary delete failed (fire-and-forget):', err));
    } catch (err) {
      // If getting the token fails, log but still proceed with local state removal.
      console.error('removePhoto: could not get ID token for Cloudinary delete:', err);
    }

    onChange(photoUrls.filter((_, i) => i !== idx));
  }

  return (
    <div className={styles.root}>
      {photoUrls.length > 0 && (
        <div className={styles.thumbs}>
          {photoUrls.map((url, idx) => (
            <div key={idx} className={styles.thumb}>
              <img src={url} alt={`Step ${stepNumber} photo ${idx + 1}`} className={styles.thumbImg} />
              <button className={styles.removeThumb} onClick={() => removePhoto(idx)} aria-label="Remove photo">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* No capture="environment": iOS already offers "Take Photo / Choose from
          Library" natively for accept="image/*". The capture attribute causes
          extra spurious onChange events during iOS camera-app handoff. */}
      <input
        key={inputKey}
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      <button
        type="button"
        className={styles.uploadBtn}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading
          ? <><Loader2 size={16} className={styles.spin} /> Uploading…</>
          : photoUrls.length > 0
            ? <><CheckCircle size={16} style={{ color: '#00C896' }} /> Add another photo</>
            : <><Camera size={16} /> Take / choose photo</>
        }
      </button>

      {error && (
        <span className={styles.errorMsg}>
          <AlertCircle size={13} /> {error}
        </span>
      )}
    </div>
  );
}
