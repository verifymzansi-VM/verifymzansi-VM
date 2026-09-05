import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const colors = {
  navy: "#0a1628",
  navySoft: "#14233b",
  green: "#00833e",
  greenDeep: "#075c34",
  gold: "#ffb81c",
  blue: "#1d4ed8",
  mint: "#dff6e9",
  paper: "#f7f4ed",
  white: "#ffffff",
  ink: "#10233c",
  muted: "#607085",
  border: "#dce3ec",
};

const sceneLength = 240;

const enter = (frame: number, from = 0, duration = 24) =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

const Screen = ({
  children,
  background = colors.paper,
}: {
  children: ReactNode;
  background?: string;
}) => (
  <AbsoluteFill
    style={{
      background,
      color: colors.ink,
      fontFamily: '"Segoe UI", Arial, sans-serif',
      overflow: "hidden",
    }}
  >
    {children}
  </AbsoluteFill>
);

const Logo = ({ dark = false }: { dark?: boolean }) => (
  <Img
    src={staticFile(dark ? "images/logo-inverse.png" : "images/logo-transparent.png")}
    style={{ width: 260, height: 56, objectFit: "contain", objectPosition: "left center" }}
  />
);

const Header = ({ label, dark = false }: { label: string; dark?: boolean }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "62px 72px 20px",
    }}
  >
    <Logo dark={dark} />
    <div
      style={{
        padding: "11px 18px",
        borderRadius: 999,
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: dark ? colors.white : colors.greenDeep,
        background: dark ? "rgba(255,255,255,0.12)" : colors.mint,
      }}
    >
      {label}
    </div>
  </div>
);

const Title = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <div
    style={{
      fontSize: 66,
      lineHeight: 1.02,
      fontWeight: 850,
      letterSpacing: -1.8,
      color: dark ? colors.white : colors.ink,
    }}
  >
    {children}
  </div>
);

const Body = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <div
    style={{
      color: dark ? "rgba(255,255,255,0.78)" : colors.muted,
      fontSize: 29,
      lineHeight: 1.34,
    }}
  >
    {children}
  </div>
);

const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      borderRadius: 28,
      background: colors.white,
      border: `1px solid ${colors.border}`,
      boxShadow: "0 18px 48px rgba(16,35,60,0.10)",
      ...style,
    }}
  >
    {children}
  </div>
);

const StepTag = ({
  number,
  text,
  color = colors.green,
}: {
  number: string;
  text: string;
  color?: string;
}) => (
  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <div
      style={{
        width: 42,
        height: 42,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.white,
        background: color,
        borderRadius: 14,
        fontWeight: 900,
        fontSize: 22,
      }}
    >
      {number}
    </div>
    <div style={{ fontSize: 23, fontWeight: 800, color }}>{text}</div>
  </div>
);

const MiniInput = ({
  label,
  required = false,
  value = "",
}: {
  label: string;
  required?: boolean;
  value?: string;
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ color: colors.ink, fontSize: 19, fontWeight: 750 }}>
      {label}
      {required ? " *" : ""}
    </div>
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        minHeight: 45,
        padding: "12px 14px",
        color: value ? colors.ink : "#9ba7b6",
        background: "#fbfcfe",
        fontSize: 18,
      }}
    >
      {value || "Enter details"}
    </div>
  </div>
);

const Choice = ({
  title,
  description,
  tone,
}: {
  title: string;
  description: string;
  tone: string;
}) => (
  <Card style={{ padding: 24, border: `2px solid ${tone}`, minHeight: 178 }}>
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 14,
        background: `${tone}20`,
        color: tone,
        fontSize: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
      }}
    >
      +
    </div>
    <div style={{ marginTop: 14, fontSize: 27, fontWeight: 850 }}>{title}</div>
    <div style={{ marginTop: 6, fontSize: 19, color: colors.muted, lineHeight: 1.25 }}>
      {description}
    </div>
  </Card>
);

const FormWindow = ({
  children,
  active = 0,
  steps,
}: {
  children: ReactNode;
  active?: number;
  steps: string[];
}) => (
  <Card style={{ overflow: "hidden", marginTop: 30 }}>
    <div style={{ display: "flex", gap: 8, padding: "16px 20px", background: "#eff3f7" }}>
      {["#ec6a5e", "#f4bf4f", "#61c554"].map((color) => (
        <div key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />
      ))}
      <div style={{ marginLeft: 12, color: colors.muted, fontSize: 16 }}>
        verifymzansi.com/post/create
      </div>
    </div>
    <div style={{ display: "flex", padding: "24px 24px 0", gap: 10 }}>
      {steps.map((step, index) => (
        <div key={step} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <div
            style={{
              height: 30,
              width: 30,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 900,
              background: index <= active ? colors.green : "#e5e9ef",
              color: index <= active ? colors.white : colors.muted,
            }}
          >
            {index + 1}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 750,
              color: index === active ? colors.greenDeep : colors.muted,
            }}
          >
            {step}
          </div>
        </div>
      ))}
    </div>
    <div style={{ padding: 28 }}>{children}</div>
  </Card>
);

const Check = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 20, color: colors.ink }}>
    <div
      style={{
        color: colors.white,
        background: colors.green,
        borderRadius: 999,
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
      }}
    >
      ✓
    </div>
    {children}
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const progress = enter(frame, 8, 32);

  return (
    <Screen background={`linear-gradient(155deg, ${colors.navy} 0%, ${colors.greenDeep} 100%)`}>
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          right: -390,
          top: -250,
        }}
      />
      <Header label="Post a listing" dark />
      <div
        style={{
          padding: "110px 72px",
          opacity: progress,
          transform: `translateY(${(1 - progress) * 45}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "11px 18px",
            borderRadius: 999,
            color: colors.gold,
            border: "1px solid rgba(255,255,255,0.20)",
            fontSize: 20,
            fontWeight: 850,
            letterSpacing: 1.3,
            textTransform: "uppercase",
          }}
        >
          Quick walkthrough
        </div>
        <div style={{ height: 28 }} />
        <Title dark>How to create a post on VerifyMzansi.</Title>
        <div style={{ height: 28 }} />
        <Body dark>
          Choose the right post type, complete the form, add clear media, and publish with
          confidence.
        </Body>
        <div style={{ height: 60 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {["Mzansi Market", "Mzansi Business", "Tourism & Events", "Preview & publish"].map(
            (item, index) => (
              <div
                key={item}
                style={{
                  padding: 22,
                  borderRadius: 20,
                  background: "rgba(255,255,255,0.10)",
                  color: colors.white,
                  fontSize: 23,
                  fontWeight: 750,
                  opacity: enter(frame, 34 + index * 12, 18),
                }}
              >
                {String(index + 1).padStart(2, "0")} &nbsp;{item}
              </div>
            )
          )}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 84,
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,0.18)",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            borderRadius: 999,
            background: colors.gold,
          }}
        />
      </div>
    </Screen>
  );
};

const ChoosePost = () => {
  const frame = useCurrentFrame();
  return (
    <Screen>
      <Header label="Step 1 of 5" />
      <div style={{ padding: "46px 72px" }}>
        <StepTag number="1" text="Start from Post" />
        <div style={{ height: 20 }} />
        <Title>Choose what you want to create.</Title>
        <div style={{ height: 14 }} />
        <Body>Open Post from the menu. Complete account verification before you submit.</Body>
        <div style={{ height: 36 }} />
        <div style={{ display: "grid", gap: 16 }}>
          {[
            ["Mzansi Market", "Sell, buy, rent, or list a single item.", colors.green],
            ["Mzansi Business", "Create a public business profile.", colors.blue],
            ["Tourism & Events", "List a tourism business or an event.", "#0f8b8d"],
          ].map(([title, description, tone], index) => (
            <div
              key={title as string}
              style={{
                opacity: enter(frame, 22 + index * 18, 22),
                transform: `translateX(${(1 - enter(frame, 22 + index * 18, 22)) * 55}px)`,
              }}
            >
              <Choice
                title={title as string}
                description={description as string}
                tone={tone as string}
              />
            </div>
          ))}
        </div>
        <div style={{ height: 32 }} />
        <Card
          style={{
            padding: 22,
            display: "flex",
            gap: 14,
            background: "#fffaf0",
            borderColor: "#f4d486",
          }}
        >
          <div style={{ color: "#b7791f", fontSize: 26 }}>!</div>
          <div style={{ color: "#7a4d10", fontSize: 20, lineHeight: 1.35 }}>
            <b>Before you post:</b> prepare your title, description, location, contact method, and
            strong cover photo.
          </div>
        </Card>
      </div>
    </Screen>
  );
};

const Market = () => {
  const frame = useCurrentFrame();
  return (
    <Screen background="#f4f8f5">
      <Header label="Step 2 of 5" />
      <div style={{ padding: "30px 72px" }}>
        <StepTag number="2" text="Mzansi Market" />
        <div style={{ height: 16 }} />
        <Title>List one item in three steps.</Title>
        <FormWindow active={0} steps={["Details", "Price & Location", "Media"]}>
          <div style={{ fontSize: 25, fontWeight: 850, marginBottom: 18 }}>Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <MiniInput label="Category" required value="Vehicles" />
            <MiniInput label="Condition" value="Good" />
            <MiniInput label="Title" required value="2019 Toyota Hilux" />
            <MiniInput label="Description" required value="Add the key facts…" />
          </div>
          <div
            style={{
              marginTop: 20,
              padding: 16,
              borderRadius: 14,
              background: colors.mint,
              color: colors.greenDeep,
              fontSize: 18,
              lineHeight: 1.3,
            }}
          >
            <b>Category fields appear automatically.</b> Vehicles ask for Make, Model, Year,
            Mileage, Transmission, Fuel Type, and Service History.
          </div>
        </FormWindow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 20 }}>
          <Card style={{ padding: 20, opacity: enter(frame, 68, 20) }}>
            <div style={{ fontWeight: 850, fontSize: 22 }}>Price & Location</div>
            <div style={{ marginTop: 12, fontSize: 18, lineHeight: 1.32, color: colors.muted }}>
              Enter price, select Province and City, then choose at least one contact method.
            </div>
          </Card>
          <Card style={{ padding: 20, opacity: enter(frame, 86, 20) }}>
            <div style={{ fontWeight: 850, fontSize: 22 }}>Media & Review</div>
            <div style={{ marginTop: 12, fontSize: 18, lineHeight: 1.32, color: colors.muted }}>
              Add at least one photo. Put the strongest image first—it becomes the cover.
            </div>
          </Card>
        </div>
      </div>
    </Screen>
  );
};

const Business = () => {
  const frame = useCurrentFrame();
  return (
    <Screen>
      <Header label="Step 3 of 5" />
      <div style={{ padding: "30px 72px" }}>
        <StepTag number="3" text="Mzansi Business" color={colors.blue} />
        <div style={{ height: 16 }} />
        <Title>Build a profile customers can trust.</Title>
        <div style={{ height: 14 }} />
        <Body>Start with your business type. The form adapts to how you operate.</Body>
        <div style={{ height: 24 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            ["Mall Store", "Store number + mall name"],
            ["Own Premises", "Street address + suburb"],
            ["Mobile Service", "Service areas"],
            ["Online Only", "Order channel + order URL"],
          ].map(([title, detail], index) => (
            <Card
              key={title}
              style={{
                padding: 20,
                opacity: enter(frame, 25 + index * 12, 18),
                borderTop: `5px solid ${colors.blue}`,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 850 }}>{title}</div>
              <div style={{ fontSize: 18, color: colors.muted, marginTop: 8 }}>{detail}</div>
            </Card>
          ))}
        </div>
        <FormWindow active={0} steps={["Details", "Location & Contact", "Media & Review"]}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <MiniInput label="Business name" required value="Nomsa's Fashion Boutique" />
            <MiniInput label="Category" required value="Fashion & Accessories" />
            <MiniInput label="Subcategory" value="Fashion Boutique" />
            <MiniInput label="About your business" required value="What you offer and why…" />
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["Services offered", "Operating hours", "Phone / WhatsApp", "Gallery photos"].map(
              (item) => (
                <div
                  key={item}
                  style={{
                    padding: "9px 12px",
                    borderRadius: 999,
                    background: "#eaf1ff",
                    color: colors.blue,
                    fontSize: 16,
                    fontWeight: 750,
                  }}
                >
                  {item}
                </div>
              )
            )}
          </div>
        </FormWindow>
      </div>
    </Screen>
  );
};

const Tourism = () => {
  const frame = useCurrentFrame();
  return (
    <Screen background={`linear-gradient(180deg, #edfbf8 0%, ${colors.paper} 100%)`}>
      <Header label="Step 4 of 5" />
      <div style={{ padding: "30px 72px" }}>
        <StepTag number="4" text="Tourism & Events" color="#0f8b8d" />
        <div style={{ height: 16 }} />
        <Title>Choose a tourism business or event.</Title>
        <div style={{ height: 14 }} />
        <Body>The type you choose controls the details required in the next step.</Body>
        <div style={{ height: 28 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Card
            style={{ padding: 24, borderTop: "6px solid #0f8b8d", opacity: enter(frame, 22, 22) }}
          >
            <div style={{ fontSize: 26, fontWeight: 850 }}>Tourism Business</div>
            <div style={{ marginTop: 14, fontSize: 19, color: colors.muted, lineHeight: 1.3 }}>
              Hotels, lodges, tours, attractions, travel agencies, car rentals, and more.
            </div>
            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              {[
                "Business name + category",
                "Booking URL + amenities",
                "Location + contact",
                "Photos + optional video",
              ].map((item) => (
                <Check key={item}>{item}</Check>
              ))}
            </div>
          </Card>
          <Card
            style={{
              padding: 24,
              borderTop: `6px solid ${colors.gold}`,
              opacity: enter(frame, 40, 22),
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 850 }}>Event</div>
            <div style={{ marginTop: 14, fontSize: 19, color: colors.muted, lineHeight: 1.3 }}>
              Festivals, markets, workshops, sports events, concerts, and community gatherings.
            </div>
            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              {[
                "Event title + event type",
                "Start date + venue",
                "Tickets + age restriction",
                "Photo or video required",
              ].map((item) => (
                <Check key={item}>{item}</Check>
              ))}
            </div>
          </Card>
        </div>
        <FormWindow active={1} steps={["Type & Basics", "Details", "Location & Contact", "Media"]}>
          <div style={{ fontSize: 24, fontWeight: 850 }}>
            Conditional details make the post useful
          </div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "#e8f7f5",
                fontSize: 18,
                lineHeight: 1.34,
              }}
            >
              <b>Accommodation:</b> rooms, check-in/out, meals, price range, and amenities.
            </div>
            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "#fff8e3",
                fontSize: 18,
                lineHeight: 1.34,
              }}
            >
              <b>Events:</b> ticket tiers, line-up, accessibility, and rain policy.
            </div>
          </div>
        </FormWindow>
      </div>
    </Screen>
  );
};

const CategoryDetails = () => {
  const frame = useCurrentFrame();
  return (
    <Screen background={colors.navy}>
      <Header label="Form tip" dark />
      <div style={{ padding: "52px 72px", color: colors.white }}>
        <Title dark>Let the category guide you.</Title>
        <div style={{ height: 16 }} />
        <Body dark>
          Once you choose a category, complete the extra fields that appear. They help the right
          customers find and compare your post.
        </Body>
        <div style={{ height: 40 }} />
        <div style={{ display: "grid", gap: 16 }}>
          {[
            ["Vehicle", "Make · Model · Year · Mileage", colors.green],
            ["Property", "Type · Sale/Rent · Bedrooms · Size", colors.gold],
            ["Food business", "Dietary options · Seating · Halal", "#70a5ff"],
            ["Tour or safari", "Activities · Duration · Group size", "#47c1ba"],
          ].map(([title, fields, tone], index) => (
            <div
              key={title as string}
              style={{
                padding: "22px 24px",
                borderLeft: `8px solid ${tone}`,
                borderRadius: 18,
                background: "rgba(255,255,255,0.09)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                opacity: enter(frame, 20 + index * 18, 18),
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 850 }}>{title}</div>
              <div style={{ fontSize: 20, color: "rgba(255,255,255,0.72)", textAlign: "right" }}>
                {fields}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
};

const Publish = () => {
  const frame = useCurrentFrame();
  const scale = spring({ fps: 30, frame, config: { damping: 15, stiffness: 100 } });
  return (
    <Screen background={`linear-gradient(155deg, ${colors.greenDeep} 0%, ${colors.navy} 100%)`}>
      <Header label="Step 5 of 5" dark />
      <div style={{ padding: "64px 72px", color: colors.white }}>
        <StepTag number="5" text="Review and publish" color={colors.gold} />
        <div style={{ height: 20 }} />
        <Title dark>Check it, then share it.</Title>
        <div style={{ height: 18 }} />
        <Body dark>
          Use the preview to confirm the post looks correct on the public marketplace.
        </Body>
        <div style={{ height: 44 }} />
        <Card
          style={{
            padding: 28,
            transform: `scale(${0.92 + scale * 0.08})`,
            transformOrigin: "center",
          }}
        >
          <div style={{ fontSize: 25, fontWeight: 850, color: colors.ink, marginBottom: 20 }}>
            Before you submit
          </div>
          <div style={{ display: "grid", gap: 17 }}>
            <Check>Required fields are complete</Check>
            <Check>Price, dates, and contact details are current</Check>
            <Check>Your strongest photo is first</Check>
            <Check>You accept the VerifyMzansi posting terms</Check>
          </div>
          <div
            style={{
              marginTop: 28,
              borderRadius: 16,
              padding: "18px 22px",
              textAlign: "center",
              background: colors.green,
              color: colors.white,
              fontSize: 24,
              fontWeight: 900,
            }}
          >
            Submit post
          </div>
        </Card>
        <div style={{ marginTop: 42, fontSize: 25, color: colors.gold, fontWeight: 800 }}>
          Manage and update your posts from the dashboard.
        </div>
      </div>
    </Screen>
  );
};

export const VerifyMzansiPostingGuide = () => (
  <AbsoluteFill style={{ background: colors.navy }}>
    <Audio
      src={staticFile("audio/verify-mzansi-launch-bed.wav")}
      volume={(frame) =>
        interpolate(frame, [0, 30, sceneLength * 7 - 30, sceneLength * 7], [0, 0.13, 0.13, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
    <Sequence from={0} durationInFrames={sceneLength}>
      <Intro />
    </Sequence>
    <Sequence from={sceneLength} durationInFrames={sceneLength}>
      <ChoosePost />
    </Sequence>
    <Sequence from={sceneLength * 2} durationInFrames={sceneLength}>
      <Market />
    </Sequence>
    <Sequence from={sceneLength * 3} durationInFrames={sceneLength}>
      <Business />
    </Sequence>
    <Sequence from={sceneLength * 4} durationInFrames={sceneLength}>
      <Tourism />
    </Sequence>
    <Sequence from={sceneLength * 5} durationInFrames={sceneLength}>
      <CategoryDetails />
    </Sequence>
    <Sequence from={sceneLength * 6} durationInFrames={sceneLength}>
      <Publish />
    </Sequence>
  </AbsoluteFill>
);
