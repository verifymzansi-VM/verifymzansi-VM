import { Composition, registerRoot } from "remotion";
import { BuyerFilm } from "./compositions/BuyerFilm";
import { BuyerPromo } from "./compositions/BuyerPromo";

/** Standalone entry for the buyer adverts, so they render independently of Root.tsx. */
const BuyerRoot = () => (
  <>
    <Composition
      id="BuyerFilm"
      component={BuyerFilm}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="BuyerPromo"
      component={BuyerPromo}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);

registerRoot(BuyerRoot);
