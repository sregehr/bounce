import { Link } from 'wouter'
import { NavLink, Screen, TopBar } from '../components/ui'
import { COVERS, useCover } from '../covers'

export function Cover() {
  const { cover, setCover, current } = useCover()
  return (
    <Screen>
      <TopBar left="Cover art" right={<NavLink to="/player">Skip</NavLink>} />

      <div style={{ height: 320, borderRadius: 24, overflow: 'hidden', background: 'var(--surface)', flex: 'none' }}>
        <img src={current.src} alt={current.alt} style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
      </div>

      <div className="row between">
        <div className="muted" style={{ fontSize: 14 }}>Same person, same pose. Only the setting changes.</div>
        <button type="button" className="link" style={{ fontSize: 14, minHeight: 24, flex: 'none' }}>Retake</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {COVERS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === cover}
            onClick={() => setCover(c.id)}
            className="col"
            style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text)', gap: 6, alignItems: 'stretch' }}
          >
            <img
              src={c.src}
              alt=""
              style={{
                width: '100%',
                height: 72,
                objectFit: 'cover',
                borderRadius: 12,
                display: 'block',
                border: `3px solid ${c.id === cover ? 'var(--accent)' : 'var(--bg)'}`,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{c.label}</span>
          </button>
        ))}
      </div>

      <div className="col" style={{ gap: 6 }}>
        <label htmlFor="cv-prompt" className="eyebrow">Or describe a setting</label>
        <input id="cv-prompt" type="text" className="field" placeholder="In the back of a cab, neon outside" />
      </div>

      <div className="foot" style={{ gap: 8 }}>
        <div className="note" style={{ lineHeight: 1.4 }}>
          Ask before you shoot. The photo is sent to an image service to be edited.
        </div>
        <Link href="/player" className="btn btn-primary">Set as cover and backdrop</Link>
      </div>
    </Screen>
  )
}
