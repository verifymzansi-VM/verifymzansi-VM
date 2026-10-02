import { Composition, registerRoot } from "remotion";
import { PremiumDiscoveryAdvert } from "./compositions/PremiumDiscoveryAdvert";

registerRoot(() => (
  <Composition
    id="VerifyMzansiPremiumDiscovery"
    component={PremiumDiscoveryAdvert}
    durationInFrames={540}
    fps={30}
    width={1080}
    height={1920}
  />
));
