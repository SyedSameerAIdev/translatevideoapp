import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState(null);
  const [targetLang, setTargetLang] = useState('hi');
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setStatus('Uploading…');
    const formData = new FormData();
    formData.append('video', file);
    formData.append('targetLang', targetLang);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.error) {
        setStatus(`Error: ${data.error}`);
      } else {
        setResultUrl(data.url);
        setStatus('Complete');
      }
    } catch (err) {
      setStatus('Request failed');
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
      <h1>Video Translation (EN↔HI)</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="video">Select Video:</label>
          <input
            id="video"
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="lang">Translate to:</label>
          <select
            id="lang"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
          >
            <option value="hi">Hindi</option>
            <option value="en">English</option>
          </select>
        </div>
        <button type="submit" disabled={!file}>Translate</button>
      </form>
      {status && <p style={{ marginTop: '1rem' }}>Status: {status}</p>}
      {resultUrl && (
        <div style={{ marginTop: '1rem' }}>
          <a href={resultUrl} target="_blank" rel="noopener noreferrer">Download Result</a>
        </div>
      )}
    </div>
  );
}