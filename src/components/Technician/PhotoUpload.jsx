import { useState, useRef } from 'react';
import { Camera, Loader2, CheckCircle, X } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../lib/firebase.js';
import styles from './PhotoUpload.module.css';

export default function PhotoUpload({ sessionId, stepNumber, photoUrls = [], onChange }) {
  const [uploading, setUploading] = useState(false);
  const [inputKey, setInputKey]   = useState(0);
  const inputRef   = useRef();
  // Keep a ref to the latest photoUrls to avoid stale closure mid-upload
  const urlsRef    = useRef(photoUrls);
  urlsRef.current  = photoUrls;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    // Reset the input immediately so the same file can be re-selected later.
    // Using a key-increment remounts the element, which is the safe React way
    // to reset a file input without triggering a spurious onChange.
    setInputKey((k) => k + 1);
    try {
      const ext  = file.name.split('.').pop() || 'jpg';
      const path = `repair-photos/${sessionId}/${stepNumber}-${Date.now()}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      onChange([...urlsRef.current, url]);
    } catch (err) {
      console.error('Photo upload failed:', err);
    } finally {
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

      <input
        key={inputKey}
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
    </div>
  );
}
