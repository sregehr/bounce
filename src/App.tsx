import { Route, Switch } from 'wouter'
import { CoverProvider } from './covers'
import { Home } from './screens/Home'
import { Capture } from './screens/Capture'
import { Record } from './screens/Record'
import { BeatReady } from './screens/BeatReady'
import { Vocals } from './screens/Vocals'
import { Playback } from './screens/Playback'
import { Advanced } from './screens/Advanced'
import { Master } from './screens/Master'
import { Export } from './screens/Export'
import { Cover } from './screens/Cover'
import { Player } from './screens/Player'
import { Vault } from './screens/Vault'
import { Snippet } from './screens/Snippet'

export function App() {
  return (
    <CoverProvider>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/capture" component={Capture} />
        <Route path="/record" component={Record} />
        <Route path="/beat" component={BeatReady} />
        <Route path="/vocals" component={Vocals} />
        <Route path="/playback" component={Playback} />
        <Route path="/advanced" component={Advanced} />
        <Route path="/master" component={Master} />
        <Route path="/export" component={Export} />
        <Route path="/cover" component={Cover} />
        <Route path="/player" component={Player} />
        <Route path="/vault" component={Vault} />
        <Route path="/snippet" component={Snippet} />
        <Route component={Home} />
      </Switch>
    </CoverProvider>
  )
}
