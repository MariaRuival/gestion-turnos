import { useEffect, useState } from 'react';

// Muestra el commit que esta corriendo en el backend (lo informa /health),
// para saber a simple vista que version esta desplegada. Si /health no
// contesta o no trae commit (ej. en docker compose local), no muestra nada.
export default function VersionBadge() {
  const [commit, setCommit] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/health', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.commit === 'string') setCommit(data.commit);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!commit) return null;
  return (
    <div className="version-badge" title={commit}>
      v{commit.slice(0, 7)}
    </div>
  );
}
