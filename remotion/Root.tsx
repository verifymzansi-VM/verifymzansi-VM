import { Composition } from "remotion";
import { VerifyMzansiAdvert } from "./compositions/VerifyMzansiAdvert";

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
    </>
  );
};
