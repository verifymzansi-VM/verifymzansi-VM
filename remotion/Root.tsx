import { Composition } from "remotion";
import {
  VerifyMzansiAdvert,
  VerifyMzansiHowItWorks,
  VerifyMzansiLaunchReveal,
  VerifyMzansiPublicPromo,
} from "./compositions/VerifyMzansiAdvert";
import { AdvertisePromo } from "./compositions/AdvertisePromo";
import { VerifyMzansiPostingGuide } from "./compositions/PostingGuide";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AdvertisePromo"
        component={AdvertisePromo}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiPostingGuide"
        component={VerifyMzansiPostingGuide}
        durationInFrames={1680}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiAdvert"
        component={VerifyMzansiAdvert}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiLaunchReveal"
        component={VerifyMzansiLaunchReveal}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiHowItWorks"
        component={VerifyMzansiHowItWorks}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiPublicPromo"
        component={VerifyMzansiPublicPromo}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
