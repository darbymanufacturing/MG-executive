import { useState, useRef } from 'react';
import { Camera, Loader2, CheckCircle, X } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../lib/firebase.js';
import styles from './PhotoUpload.module.css';

export default function PhotoUpload({ sessionId, stepNumber, photoUrls = [], onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext  = file.name.split('.').pop() || 'jpg';
      const path = `repair-photos/${sessionId}/${stepNumber}-${Date.now()}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      onChange([...photoUrls, url]);
    } finally {
      setUploading(false);
      e.target.value = '';
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
