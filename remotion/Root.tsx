import { Composition } from "remotion";
import {
  VerifyMzansiAdvert,
  VerifyMzansiHowItWorks,
  VerifyMzansiLaunchReveal,
  VerifyMzansiPublicPromo,
} from "./compositions/VerifyMzansiAdvert";

export const RemotionRoot = () => {
  return (
    <>
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
