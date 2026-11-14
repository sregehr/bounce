import { NavLink, PlayIcon, Screen, TopBar } from '../components/ui'

function Radio({ name, label, hint, checked, last }: { name: string; label: string; hint: string; checked?: boolean; last?: boolean }) {
  return (
    <label className={`option${last ? '' : ' divided'}`}>
      <input type="radio" name={name} defaultChecked={checked} />
      <span className="grow">{label}</span>
      <span className="small muted" style={{ fontWeight: 400 }}>{hint}</span>
    </label>
  )
}

export function Export() {
  return (
    <Screen>
      <TopBar left="Export" right={<NavLink to="/master">Back</NavLink>} />

      <div className="card" style={{ borderRadius: 16, padding: '14px 16px', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="col" style={{ gap: 2 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Untitled beat 13</div>
          <div className="small muted">2:41 · beat and vocals · Punchy</div>
        </div>
        <button type="button" aria-label="Play" className="round-play">
          <PlayIcon />
        </button>
      </div>

      <fieldset className="group">
        <legend className="eyebrow">Loudness</legend>
        <Radio name="loud" label="Streaming" hint="−14 LUFS" checked />
        <Radio name="loud" label="Loud, for socials and demos" hint="−9 LUFS" />
        <Radio name="loud" label="Keep as mastered" hint="−9.4 LUFS" last />
      </fieldset>

      <fieldset className="group">
        <legend className="eyebrow">Format</legend>
        <Radio name="fmt" label="WAV" hint="24-bit · full quality" checked />
        <Radio name="fmt" label="M4A" hint="Small · easy to send" last />
      </fieldset>

      <fieldset className="group">
        <legend className="eyebrow">Also include</legend>
        <label className="option">
          <input type="checkbox" defaultChecked style={{ width: 20, height: 20 }} />
          <span>Instrumental, mastered to match</span>
        </label>
        <label className="option">
          <input type="checkbox" style={{ width: 20, height: 20 }} />
          <span>Vocals only</span>
        </label>
      </fieldset>

      <div className="foot">
        <button type="button" className="btn btn-primary">Share</button>
        <button type="button" className="btn btn-outline" style={{ flex: 'none', fontSize: 16 }}>Save to Files</button>
        <NavLink to="/cover" center>Add cover art and play it</NavLink>
      </div>
    </Screen>
  )
}
