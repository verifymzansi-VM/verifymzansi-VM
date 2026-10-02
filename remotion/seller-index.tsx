import { Composition, registerRoot } from "remotion";
import { ShowYourOfferAdvert } from "./compositions/ShowYourOfferAdvert";
registerRoot(() => (
  <Composition
    id="VerifyMzansiShowYourOffer"
    component={ShowYourOfferAdvert}
    durationInFrames={600}
    fps={30}
    width={1080}
    height={1920}
  />
));
