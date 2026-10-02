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

const colour = {
  ink: "#092e30",
  orange: "#eaa67e",
  cream: "#f6f1e8",
  coral: "#d95c42",
  green: "#147963",
  gold: "#edca82",
};
const clamp = (f: number, start: number, end: number) =>
  interpolate(f, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
const arrive = (f: number, start = 0, end = 32) => 1 - (1 - clamp(f, start, end)) ** 3;
const body = '"Offer Body", "Segoe UI", sans-serif';
const display = '"Offer Display", "Segoe UI", sans-serif';
type Kind = "market" | "business" | "tourism";

const LoadFonts = () => {
  const [handle] = useState(() => delayRender("Loading seller advert fonts"));
  useEffect(() => {
    const fonts = [
      new FontFace(
        "Offer Display",
        `url(${staticFile("fonts/video/bricolage-grotesque-latin.woff2")})`,
        { weight: "200 800" }
      ),
      new FontFace(
        "Offer Body",
        `url(${staticFile("fonts/video/plus-jakarta-sans-latin.woff2")})`,
        { weight: "200 800" }
      ),
    ];
    Promise.all(fonts.map((font) => font.load()))
      .then((loaded) => {
        loaded.forEach((font) => document.fonts.add(font));
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);
  return null;
};

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
        opacity: (first ? 1 : clamp(f, 0, 10)) * (1 - clamp(f, 120, 132)),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const Headline = ({
  children,
  top,
  size = 135,
  delay = 0,
  light = true,
  accent = false,
}: {
  children: ReactNode;
  top: number;
  size?: number;
  delay?: number;
  light?: boolean;
  accent?: boolean;
}) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top,
        overflow: "hidden",
        paddingBottom: 15,
      }}
    >
      <div
        style={{
          fontFamily: accent ? 'Georgia, "Times New Roman", serif' : display,
          fontStyle: accent ? "italic" : "normal",
          fontWeight: accent ? 400 : 750,
          fontSize: size,
          lineHeight: 1.04,
          letterSpacing: -5,
          color: accent
            ? light
              ? colour.orange
              : colour.green
            : light
              ? colour.cream
              : colour.ink,
          transform: `translateY(${(1 - arrive(f, delay, delay + 28)) * 150}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

const Caption = ({
  children,
  top,
  light = false,
}: {
  children: ReactNode;
  top: number;
  light?: boolean;
}) => (
  <div
    style={{
      position: "absolute",
      left: 76,
      right: 76,
      top,
      fontFamily: body,
      fontSize: 32,
      lineHeight: 1.5,
      color: light ? colour.cream : colour.ink,
    }}
  >
    {children}
  </div>
);

const Label = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div
    style={{
      position: "absolute",
      left: 76,
      top: 263,
      fontFamily: body,
      fontSize: 23,
      fontWeight: 600,
      letterSpacing: 4,
      color: light ? colour.gold : colour.green,
    }}
  >
    {children}
  </div>
);

const Texture = ({ light = false }: { light?: boolean }) => {
  const f = useCurrentFrame();
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: -450 + f * 1.2,
          top: 420,
          width: 1350,
          height: 1500,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, ${light ? "#faedce99" : "#137b695e"}, transparent 66%)`,
        }}
      />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 930 + i * 160,
            height: 1300 + i * 180,
            border: `1px solid ${light ? "#092e3016" : "#edca8220"}`,
            borderRadius: "50%",
            top: 750 - i * 90,
            left: 250 - i * 80,
            transform: `rotate(${-20 + Math.sin(f / 65) * 4}deg)`,
          }}
        />
      ))}
    </>
  );
};

const Footage = ({ kind }: { kind: Kind }) => (
  <OffthreadVideo
    src={staticFile(`video/seller-story/${kind}.mp4`)}
    muted
    playbackRate={0.94}
    style={{ width: "100%", height: "100%", objectFit: "cover" }}
  />
);

const FilmPanel = ({
  kind,
  left,
  top,
  width,
  height,
  rotation = 0,
  delay = 0,
}: {
  kind: Kind;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation?: number;
  delay?: number;
}) => {
  const f = useCurrentFrame();
  const t = arrive(f, delay, delay + 42);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        border: "7px solid #f6f1e8",
        borderRadius: 38,
        overflow: "hidden",
        boxShadow: "0 38px 100px #001a2340",
        opacity: clamp(f, delay, delay + 12),
        transform: `perspective(1800px) translateY(${(1 - t) * 260 + Math.sin(f / 40) * 10}px) rotate(${rotation + Math.sin(f / 70) * 1.5}deg) rotateY(${(1 - t) * 20}deg)`,
      }}
    >
      <Footage kind={kind} />
    </div>
  );
};

const Hook = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={colour.ink} first>
      <Texture />
      <Label light>FOR PEOPLE WITH SOMETHING TO OFFER</Label>
      <Headline top={355} size={131}>
        Your hustle.
      </Headline>
      <Headline top={505} size={141} accent delay={8}>
        Has a story.
      </Headline>
      <FilmPanel
        kind="business"
        left={230}
        top={805}
        width={620}
        height={1040}
        rotation={-4}
        delay={5}
      />
      <div
        style={{
          position: "absolute",
          left: 38,
          top: 1100,
          width: 190,
          fontFamily: display,
          fontSize: 90,
          fontWeight: 750,
          color: "#edca8244",
          writingMode: "vertical-rl",
          transform: `translateY(${-f * 0.45}px)`,
        }}
      >
        SHOW IT.
      </div>
      <div
        style={{
          position: "absolute",
          right: 92,
          top: 920,
          width: 84,
          height: 84,
          borderRadius: "50%",
          background: colour.orange,
          color: colour.ink,
          display: "grid",
          placeItems: "center",
          fontSize: 42,
          transform: `scale(${arrive(f, 15, 35)}) rotate(${f * 0.15}deg)`,
        }}
      >
        ↗
      </div>
    </Stage>
  );
};

const Video = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={colour.orange}>
      <Texture light />
      <Label>01 / SHOW YOUR OFFER</Label>
      <Headline top={355} size={149} light={false}>
        Show it.
      </Headline>
      <Headline top={515} size={150} light={false} accent delay={8}>
        In motion.
      </Headline>
      <Caption top={704}>Products. Services. Experiences.</Caption>
      <FilmPanel
        kind="market"
        left={260}
        top={870}
        width={565}
        height={905}
        rotation={3}
        delay={3}
      />
      <div
        style={{
          position: "absolute",
          left: 212,
          top: 830,
          right: 212,
          height: 980,
          border: "2px solid #092e3060",
          borderRadius: 50,
          transform: `scale(${0.97 + Math.sin(f / 26) * 0.02})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1570,
          padding: "21px 26px",
          borderRadius: 999,
          background: colour.ink,
          color: colour.cream,
          fontFamily: body,
          fontSize: 27,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: colour.coral,
            opacity: Math.floor(f / 15) % 2 ? 0.5 : 1,
          }}
        />
        SHORT VIDEO
      </div>
    </Stage>
  );
};

/** An illustrative post-building sequence; no live post is submitted. */
const Listing = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={colour.cream}>
      <Texture light />
      <Label>02 / CREATE YOUR POST</Label>
      <Headline top={355} size={140} light={false}>
        Give it
      </Headline>
      <Headline top={510} size={143} light={false} accent delay={8}>
        a home.
      </Headline>
      <Caption top={702}>Go live after identity and post review.</Caption>
      <div
        style={{
          position: "absolute",
          left: 88,
          right: 88,
          top: 865,
          height: 906,
          borderRadius: 46,
          background: "white",
          border: "1px solid #092e301f",
          boxShadow: "0 40px 90px #092e301a",
          padding: 45,
          transform: `perspective(1600px) translateY(${(1 - arrive(f, 3, 38)) * 220}px) rotateX(${(1 - arrive(f, 3, 38)) * 16}deg)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: display,
            fontSize: 41,
            fontWeight: 650,
            color: colour.ink,
          }}
        >
          <span>Create your post</span>
          <span style={{ color: colour.green }}>+</span>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 32, fontFamily: body, fontSize: 18 }}>
          {["Market", "Business", "Tourism & Events"].map((label, i) => (
            <div
              key={label}
              style={{
                padding: "13px 20px",
                borderRadius: 30,
                background: i === 1 ? colour.green : "#f0f3ef",
                color: i === 1 ? "white" : colour.ink,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 45,
            top: 225,
            width: 345,
            height: 484,
            overflow: "hidden",
            borderRadius: 25,
          }}
        >
          <Footage kind="business" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 420,
            right: 45,
            top: 239,
            fontFamily: body,
            color: colour.ink,
          }}
        >
          <div style={{ fontSize: 23, color: "#6e827b" }}>Your offer</div>
          <div style={{ marginTop: 18, fontSize: 37, lineHeight: 1.3, fontWeight: 700 }}>
            A product.
            <br />A service.
            <br />A new experience.
          </div>
          <div style={{ marginTop: 45, height: 5, borderRadius: 5, background: "#e7efe7" }}>
            <div
              style={{
                width: `${100 * arrive(f, 18, 82)}%`,
                height: "100%",
                background: colour.green,
                borderRadius: 5,
              }}
            />
          </div>
          <div style={{ fontSize: 21, marginTop: 18, color: colour.green }}>
            Photos + short video
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 45,
            right: 45,
            bottom: 45,
            padding: "26px 28px",
            borderRadius: 24,
            fontFamily: body,
            fontSize: 26,
            fontWeight: 650,
            color: "white",
            background: colour.ink,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Create your post</span>
          <span>→</span>
        </div>
      </div>
    </Stage>
  );
};

const PhoneIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="47"
    height="47"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 16.9V20a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" />
  </svg>
);
const ChatIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="48"
    height="48"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" />
  </svg>
);

const Connection = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={colour.ink}>
      <Texture />
      <Label light>03 / DIRECT CONTACT</Label>
      <Headline top={355} size={135}>
        Make the
      </Headline>
      <Headline top={505} size={134} accent delay={8}>
        connection.
      </Headline>
      <Caption top={708} light>
        Interested people contact you directly.
      </Caption>
      <FilmPanel
        kind="tourism"
        left={72}
        top={875}
        width={480}
        height={852}
        rotation={-3}
        delay={2}
      />
      {[
        { title: "Call", icon: <PhoneIcon />, top: 1070, fill: colour.cream, text: colour.ink },
        { title: "WhatsApp", icon: <ChatIcon />, top: 1370, fill: colour.green, text: "white" },
      ].map((item, i) => (
        <div
          key={item.title}
          style={{
            position: "absolute",
            left: 600,
            width: 394,
            top: item.top,
            height: 206,
            padding: "35px 30px",
            borderRadius: 32,
            background: item.fill,
            color: item.text,
            boxShadow: "0 28px 55px #0003",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: body,
            fontSize: 32,
            fontWeight: 650,
            opacity: clamp(f, 12 + i * 12, 30 + i * 12),
            transform: `translateX(${(1 - arrive(f, 12 + i * 12, 48 + i * 12)) * 200}px) translateY(${Math.sin(f / 25 + i) * 8}px)`,
          }}
        >
          <span>{item.icon}</span>
          <span>
            {item.title}
            <span style={{ float: "right" }}>↗</span>
          </span>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 604,
          top: 1625,
          width: 372,
          fontFamily: body,
          fontSize: 24,
          lineHeight: 1.6,
          color: colour.gold,
        }}
      >
        Your offer.
        <br />A real conversation.
      </div>
    </Stage>
  );
};

const Finale = () => {
  const f = useCurrentFrame();
  return (
    <Stage background={colour.orange}>
      <Texture light />
      <Label>YOUR NEXT MOVE</Label>
      <Headline top={355} size={132} light={false}>
        Show what
      </Headline>
      <Headline top={505} size={147} light={false} accent delay={8}>
        you offer.
      </Headline>
      <Caption top={717}>Start advertising on VerifyMzansi.</Caption>
      <div
        style={{
          position: "absolute",
          top: 880,
          left: 258,
          width: 565,
          height: 565,
          border: "1px solid #092e3033",
          borderRadius: "50%",
          background: "radial-gradient(circle at 28% 20%, #ffe2b9bb, #f0ba9144 65%)",
          transform: `perspective(1600px) rotateY(${(1 - arrive(f, 5, 45)) * -40}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 37,
            border: "1px solid #092e3022",
            borderRadius: "50%",
            transform: `rotateX(65deg) rotateZ(${f * 0.6}deg)`,
          }}
        />
        <Img
          src={staticFile("images/brand-shield.png")}
          style={{
            width: 355,
            height: 355,
            objectFit: "contain",
            position: "absolute",
            top: 104,
            left: 104,
            transform: `scale(${0.6 + arrive(f, 4, 40) * 0.4}) translateY(${Math.sin(f / 25) * 10}px)`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          top: 1550,
          padding: "37px 32px",
          borderRadius: 70,
          fontFamily: body,
          fontSize: 39,
          fontWeight: 750,
          background: colour.ink,
          color: colour.cream,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: clamp(f, 13, 28),
          transform: `translateY(${(1 - arrive(f, 13, 45)) * 95}px)`,
        }}
      >
        <span>verifymzansi.com/advertise</span>
        <span style={{ fontSize: 58 }}>↗</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          top: 1750,
          textAlign: "center",
          fontFamily: body,
          fontSize: 25,
          color: colour.ink,
          letterSpacing: 2,
        }}
      >
        SHOW. LIST. CONNECT.
      </div>
    </Stage>
  );
};

export const ShowYourOfferAdvert = () => {
  const f = useCurrentFrame();
  const light = f < 120 || (f >= 360 && f < 480);
  return (
    <AbsoluteFill style={{ background: colour.ink, overflow: "hidden" }}>
      <LoadFonts />
      <Audio
        src={staticFile("audio/mzansi-seller-groove.wav")}
        volume={(t) =>
          interpolate(t, [0, 12, 575, 599], [0, 0.72, 0.72, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      <Sequence from={0} durationInFrames={132}>
        <Hook />
      </Sequence>
      <Sequence from={120} durationInFrames={132}>
        <Video />
      </Sequence>
      <Sequence from={240} durationInFrames={132}>
        <Listing />
      </Sequence>
      <Sequence from={360} durationInFrames={132}>
        <Connection />
      </Sequence>
      <Sequence from={480} durationInFrames={120}>
        <Finale />
      </Sequence>
      <Img
        src={staticFile(light ? "images/logo-inverse.png" : "images/logo-transparent.png")}
        style={{
          position: "absolute",
          left: 76,
          top: 91,
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
          letterSpacing: 3,
          color: light ? colour.gold : colour.ink,
        }}
      >
        SHOW WHAT YOU OFFER
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          bottom: 53,
          height: 2,
          background: "#14796333",
        }}
      >
        <div
          style={{
            width: `${(100 * f) / 599}%`,
            height: "100%",
            background: light ? colour.gold : colour.green,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
