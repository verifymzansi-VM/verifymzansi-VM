import { useEffect, useState, type ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
type FilmKind = "market" | "business" | "tourism";

const c = { ink: "#081f1b", jade: "#064f3d", cream: "#f5f0e4", gold: "#dfba72", white: "#fffaf0" };
const p = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
const smooth = (f: number, a: number, b: number) => {
  const t = p(f, a, b);
  return 1 - (1 - t) ** 3;
};
const display = '"Mzansi Display", "Segoe UI", sans-serif';
const body = '"Mzansi Body", "Segoe UI", sans-serif';

const Fonts = () => {
  const [handle] = useState(() => delayRender("Loading premium advert typography"));
  useEffect(() => {
    const faces = [
      new FontFace(
        "Mzansi Display",
        `url(${staticFile("fonts/video/bricolage-grotesque-latin.woff2")})`,
        { weight: "200 800" }
      ),
      new FontFace(
        "Mzansi Body",
        `url(${staticFile("fonts/video/plus-jakarta-sans-latin.woff2")})`,
        { weight: "200 800" }
      ),
    ];
    Promise.all(faces.map((face) => face.load()))
      .then((loaded) => {
        loaded.forEach((face) => document.fonts.add(face));
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);
  return null;
};

const Film = ({ kind }: { kind: FilmKind }) => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
    <OffthreadVideo
      src={staticFile(`video/advert-originals/${kind}.mp4`)}
      playbackRate={0.85}
      muted
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </div>
);

const Stage = ({
  children,
  background,
  first = false,
}: {
  children: ReactNode;
  background: string;
  first?: boolean;
}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background,
        overflow: "hidden",
        opacity: (first ? 1 : p(f, 0, 12)) * (1 - p(f, 108, 120)),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const Eyebrow = ({
  children,
  top = 260,
  dark = false,
}: {
  children: ReactNode;
  top?: number;
  dark?: boolean;
}) => (
  <div
    style={{
      position: "absolute",
      left: 76,
      top,
      fontFamily: body,
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: 5,
      color: dark ? c.jade : c.gold,
    }}
  >
    {children}
  </div>
);

const Line = ({
  children,
  top,
  delay = 0,
  size = 116,
  dark = false,
  italic = false,
}: {
  children: ReactNode;
  top: number;
  delay?: number;
  size?: number;
  dark?: boolean;
  italic?: boolean;
}) => {
  const f = useCurrentFrame();
  const t = smooth(f, delay, delay + 26);
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 60,
        top,
        overflow: "hidden",
        paddingBottom: 20,
      }}
    >
      <div
        style={{
          transform: `translateY(${(1 - t) * 160}px)`,
          fontFamily: italic ? 'Georgia, "Times New Roman", serif' : display,
          fontStyle: italic ? "italic" : "normal",
          fontWeight: italic ? 400 : 700,
          fontSize: size,
          lineHeight: 1.03,
          letterSpacing: italic ? -4 : -5,
          color: italic ? (dark ? c.jade : c.gold) : dark ? c.ink : c.white,
        }}
      >
        {children}
      </div>
    </div>
  );
};

const Ambient = ({ light = false }: { light?: boolean }) => {
  const f = useCurrentFrame();
  return (
    <>
      <div
        style={{
          position: "absolute",
          width: 1250,
          height: 1450,
          left: -430 + f * 1.4,
          top: 320,
          background: `radial-gradient(ellipse, ${light ? "#d6dbc940" : "#16876360"}, transparent 65%)`,
        }}
      />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 830 + i * 200,
            height: 830 + i * 200,
            border: `1px solid ${light ? "#064f3d18" : "#dfba721f"}`,
            borderRadius: "50%",
            left: 390 - i * 100,
            top: 890 - i * 100,
            transform: `translateY(${Math.sin(f / 70) * 40}px) rotateX(24deg)`,
          }}
        />
      ))}
    </>
  );
};

const Panel = ({
  kind,
  left,
  top,
  width,
  height,
  rotation = 0,
  delay = 0,
  arch = false,
}: {
  kind: FilmKind;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation?: number;
  delay?: number;
  arch?: boolean;
}) => {
  const f = useCurrentFrame();
  const t = smooth(f, delay, delay + 40);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        padding: 7,
        background: c.cream,
        borderRadius: arch ? `${width / 2}px ${width / 2}px 28px 28px` : 34,
        boxShadow: "0 45px 90px #0005",
        opacity: p(f, delay, delay + 12),
        transform: `perspective(1800px) translateY(${(1 - t) * 240 + Math.sin(f / 55) * 12}px) rotate(${rotation + Math.sin(f / 70) * 1.8}deg) rotateY(${(1 - t) * -16}deg) scale(${0.9 + t * 0.1})`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: arch ? `${width / 2}px ${width / 2}px 23px 23px` : 28,
          overflow: "hidden",
        }}
      >
        <Film kind={kind} />
      </div>
    </div>
  );
};

const Intro = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={c.ink} first>
      <Ambient />
      <Eyebrow>THREE WORLDS. ONE VERIFYMZANSI.</Eyebrow>
      <Line top={360} size={123}>
        A whole world.
      </Line>
      <Line top={500} size={125} italic delay={7}>
        Closer to you.
      </Line>
      <Panel
        kind="business"
        left={-105}
        top={920}
        width={365}
        height={650}
        rotation={-13}
        delay={10}
      />
      <Panel
        kind="tourism"
        left={845}
        top={890}
        width={360}
        height={640}
        rotation={13}
        delay={18}
      />
      <Panel kind="market" left={292} top={775} width={500} height={888} rotation={-3} delay={4} />
      <div
        style={{
          position: "absolute",
          left: 185,
          top: 1700,
          width: 710,
          height: 1,
          background: c.gold,
          transform: `scaleX(${smooth(f, 30, 75)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 70,
          right: 70,
          top: 1750,
          textAlign: "center",
          fontFamily: body,
          fontSize: 27,
          color: c.cream,
          letterSpacing: 1,
        }}
      >
        Discover what’s waiting around you.
      </div>
    </Stage>
  );
};

const Market = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={c.cream}>
      <Ambient light />
      <Eyebrow dark>01 / MZANSI MARKET</Eyebrow>
      <Line top={360} size={130} dark>
        Find your next
      </Line>
      <Line top={505} size={140} dark italic delay={7}>
        favourite.
      </Line>
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 890,
          fontFamily: display,
          fontSize: 305,
          letterSpacing: -22,
          fontWeight: 600,
          color: "#064f3d0c",
          transform: `translateY(${-f * 0.6}px)`,
        }}
      >
        01
      </div>
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1080,
          fontFamily: body,
          fontSize: 50,
          color: c.jade,
          lineHeight: 1.55,
          fontWeight: 500,
          opacity: p(f, 18, 36),
        }}
      >
        Buy.
        <br />
        Sell.
        <br />
        Find.
      </div>
      <Panel kind="market" left={400} top={750} width={590} height={1048} rotation={-4} delay={4} />
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1690,
          width: 220,
          height: 1,
          background: c.jade,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1725,
          width: 250,
          fontFamily: body,
          fontSize: 26,
          lineHeight: 1.5,
          color: c.ink,
        }}
      >
        Good finds.
        <br />
        Local connections.
      </div>
    </Stage>
  );
};

const Business = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={c.ink}>
      <Ambient />
      <Eyebrow>02 / MZANSI BUSINESS</Eyebrow>
      <Line top={360} size={132}>
        Local people.
      </Line>
      <Line top={510} size={120} italic delay={7}>
        Real possibility.
      </Line>
      <Panel kind="business" left={82} top={790} width={610} height={1084} rotation={2} delay={2} />
      <div
        style={{
          position: "absolute",
          left: 760,
          top: 875,
          height: 750,
          width: 1,
          background: c.gold,
          transformOrigin: "top",
          transform: `scaleY(${smooth(f, 10, 50)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 870,
          left: 820,
          fontFamily: body,
          fontSize: 27,
          fontWeight: 500,
          letterSpacing: 4,
          writingMode: "vertical-rl",
          color: c.gold,
          opacity: p(f, 15, 30),
        }}
      >
        SHOPS · SERVICES · LOCAL BUSINESS
      </div>
      <div
        style={{
          position: "absolute",
          left: 757,
          top: 1680,
          fontFamily: display,
          fontSize: 128,
          color: c.gold,
          fontWeight: 400,
        }}
      >
        02
      </div>
    </Stage>
  );
};

const Tourism = () => {
  const f = useCurrentFrame();
  return (
    <Stage background="#0c343c">
      <Img
        src={staticFile("images/showrooms/tourism-v2-mobile.avif")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${1.13 + f * 0.0007}) translateX(${-f * 0.18}px)`,
        }}
      />
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, #081f1bef, #081f1b66 65%, #081f1bc9)" }}
      />
      <Eyebrow>03 / TOURISM & EVENTS</Eyebrow>
      <Line top={360} size={125}>
        Make room for
      </Line>
      <Line top={510} size={141} italic delay={7}>
        new memories.
      </Line>
      <Panel
        kind="tourism"
        left={390}
        top={790}
        width={555}
        height={986}
        rotation={3}
        delay={5}
        arch
      />
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 1040,
          width: 245,
          fontFamily: body,
          fontSize: 43,
          lineHeight: 1.65,
          color: c.cream,
          opacity: p(f, 15, 35),
        }}
      >
        Places.
        <br />
        Stays.
        <br />
        Experiences.
      </div>
      <div
        style={{
          position: "absolute",
          left: 73,
          top: 1640,
          fontFamily: display,
          fontSize: 130,
          color: c.gold,
          fontWeight: 400,
        }}
      >
        03
      </div>
    </Stage>
  );
};

const Finale = () => {
  const f = useCurrentFrame();
  const turn = smooth(f, 3, 40);
  return (
    <Stage background={c.ink}>
      <Ambient />
      <Eyebrow>YOUR NEXT DISCOVERY</Eyebrow>
      <Line top={350} size={148}>
        Starts here.
      </Line>
      <Line top={525} size={125} italic delay={8}>
        VerifyMzansi.
      </Line>
      <div
        style={{
          position: "absolute",
          left: 228,
          top: 785,
          width: 625,
          height: 625,
          borderRadius: "50%",
          background: "radial-gradient(circle at 30% 20%, #13735c, #062e25 60%, #041c18)",
          boxShadow:
            "inset 0 0 0 1px #dfba7255, inset 15px 25px 60px #a1f4c315, 0 35px 100px #0007",
          transform: `perspective(1400px) scale(${0.8 + turn * 0.2}) rotateY(${(1 - turn) * -45}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 32,
            border: "1px solid #dfba7233",
            borderRadius: "50%",
            transform: `rotateX(62deg) rotateZ(${f * 0.75}deg)`,
          }}
        />
        <Img
          src={staticFile("images/brand-shield.png")}
          style={{
            position: "absolute",
            left: 128,
            top: 119,
            width: 370,
            height: 370,
            objectFit: "contain",
            transform: `translateY(${Math.sin(f / 23) * 12}px) rotateY(${(1 - turn) * 45}deg)`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          top: 1510,
          height: 118,
          padding: "30px 36px",
          borderRadius: 70,
          background: c.cream,
          color: c.ink,
          fontFamily: body,
          fontSize: 52,
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: p(f, 12, 24),
          transform: `translateY(${(1 - smooth(f, 12, 38)) * 80}px)`,
        }}
      >
        <span>verifymzansi.com</span>
        <span
          style={{
            fontSize: 66,
            fontWeight: 400,
            transform: `translateX(${Math.sin(f / 18) * 5}px)`,
          }}
        >
          ↗
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 75,
          right: 75,
          top: 1735,
          textAlign: "center",
          fontFamily: body,
          fontSize: 21,
          letterSpacing: 3,
          color: c.gold,
        }}
      >
        MARKET / BUSINESS / TOURISM & EVENTS
      </div>
    </Stage>
  );
};

export const PremiumDiscoveryAdvert = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: c.ink, color: c.white, overflow: "hidden" }}>
      <Fonts />
      <Audio
        src={staticFile("audio/mzansi-editorial-groove.wav")}
        volume={(t) =>
          interpolate(t, [0, 12, 510, 539], [0, 0.72, 0.72, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      <Sequence from={0} durationInFrames={120}>
        <Intro />
      </Sequence>
      <Sequence from={108} durationInFrames={120}>
        <Market />
      </Sequence>
      <Sequence from={216} durationInFrames={120}>
        <Business />
      </Sequence>
      <Sequence from={324} durationInFrames={120}>
        <Tourism />
      </Sequence>
      <Sequence from={432} durationInFrames={108}>
        <Finale />
      </Sequence>
      <Img
        src={staticFile(
          f >= 108 && f < 216 ? "images/logo-transparent.png" : "images/logo-inverse.png"
        )}
        style={{
          position: "absolute",
          left: 76,
          top: 92,
          width: 300,
          height: 100,
          objectFit: "contain",
          objectPosition: "left",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 76,
          top: 117,
          fontFamily: body,
          fontSize: 20,
          letterSpacing: 4,
          color: f >= 108 && f < 216 ? c.jade : c.gold,
        }}
      >
        DISCOVER LOCAL
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          bottom: 53,
          height: 2,
          background: "#dfba7228",
        }}
      >
        <div style={{ width: `${(100 * f) / 539}%`, height: "100%", background: c.gold }} />
      </div>
    </AbsoluteFill>
  );
};
