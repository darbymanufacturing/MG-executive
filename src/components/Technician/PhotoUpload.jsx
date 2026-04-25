import { useState, useRef } from 'react';
import { Camera, Loader2, CheckCircle, X, AlertCircle } from 'lucide-react';
import styles from './PhotoUpload.module.css';

const CLOUDINARY_CLOUD_NAME    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = 'repair_photos';

export default function PhotoUpload({ sessionId, stepNumber, photoUrls = [], onChange }) {
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
      if (!CLOUDINARY_CLOUD_NAME) {
        throw new Error('Missing VITE_CLOUDINARY_CLOUD_NAME env var');
      }

      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      form.append('folder', `repair-photos/${sessionId}`);
      form.append('public_id', `${stepNumber}-${Date.now()}`);
      form.append('context', `sessionId=${sessionId}|stepNumber=${stepNumber}`);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: form }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cloudinary ${res.status}: ${body}`);
      }
      const data = await res.json();
      const url  = data.secure_url;
      onChange([...urlsRef.current, url]);
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

  function removePhoto(idx) {
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
