import { Composition } from "remotion";
import {
  VerifyMzansiAdvert,
  VerifyMzansiHowItWorks,
  VerifyMzansiLaunchReveal,
  VerifyMzansiPublicPromo,
} from "./compositions/VerifyMzansiAdvert";
import { AdvertisePromo } from "./compositions/AdvertisePromo";
import { VerifyMzansiPostingGuide } from "./compositions/PostingGuide";
import { ShortSocialAdvert } from "./compositions/ShortSocialAdvert";
import { BuyerPromo } from "./compositions/BuyerPromo";
import { BuyerFilm } from "./compositions/BuyerFilm";
import { PremiumDiscoveryAdvert } from "./compositions/PremiumDiscoveryAdvert";
import { ShowYourOfferAdvert } from "./compositions/ShowYourOfferAdvert";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="VerifyMzansiShowYourOffer"
        component={ShowYourOfferAdvert}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiPremiumDiscovery"
        component={PremiumDiscoveryAdvert}
        durationInFrames={540}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VerifyMzansiShortSocial"
        component={ShortSocialAdvert}
        durationInFrames={480}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ runwayClip: null }}
      />
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
