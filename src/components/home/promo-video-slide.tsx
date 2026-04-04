"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Store,
  Briefcase,
  Smartphone,
  ScanFace,
  MapPin,
  CreditCard,
} from "lucide-react";
import { BrandLogo } from "../shared/brand-logo";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/* ── Animation presets (matching project conventions) ── */
const SPRING = { type: "spring" as const, stiffness: 260, damping: 20 };

const PHASE_DURATIONS = [3500, 4000, 4500, 3500, 2500]; // ms per phase

/* ── Sub-components for each phase ── */

function LogoEntrance({ noMotion }: { noMotion: boolean }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-4 sm:gap-6"
      initial={noMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={noMotion ? undefined : { opacity: 0 }}
      transition={{ duration: noMotion ? 0 : 0.4 }}
    >
      <motion.div
        className="flex items-center gap-2 sm:gap-3"
        initial={noMotion ? false : { scale: 0.8, filter: "blur(8px)", opacity: 0 }}
        animate={{ scale: 1, filter: "blur(0px)", opacity: 1 }}
        transition={noMotion ? { duration: 0 } : { ...SPRING, duration: 0.8 }}
      >
        <BrandLogo
          size="lg"
          tone="inverse"
          priority
          imageClassName="drop-shadow-[0_10px_24px_rgba(0,0,0,0.4)]"
        />
      </motion.div>

      <motion.p
        className="font-display text-xl sm:text-3xl lg:text-4xl font-bold text-white text-center leading-tight"
        initial={noMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={noMotion ? { duration: 0 } : { delay: 0.5, duration: 0.6 }}
      >
        South Africa&apos;s{" "}
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green-400 to-brand-gold-400">
          Trusted Marketplace
        </span>
      </motion.p>

      <motion.div
        className="flex items-center gap-2"
        initial={noMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={noMotion ? { duration: 0 } : { delay: 1.0, duration: 0.5 }}
      >
        <Image
          src="/images/sa-flag.png"
          alt="South African flag"
          width={32}
          height={20}
          className="h-4 sm:h-5 w-auto rounded-sm"
        />
        <span className="text-sm sm:text-base text-white/70 font-medium">Made for Mzansi</span>
      </motion.div>
    </motion.div>
  );
}

function ValuePropsReveal({ noMotion }: { noMotion: boolean }) {
  const props = [
    { text: "Verification-First", accent: "text-brand-green-400" },
    { text: "POPIA Compliant", accent: "text-brand-blue-400" },
    { text: "Get Verified in Under 5 Minutes", accent: "text-brand-gold-400" },
  ];

  return (
    <motion.div
      className="flex flex-col items-center gap-4 sm:gap-6"
      initial={noMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={noMotion ? undefined : { opacity: 0 }}
      transition={{ duration: noMotion ? 0 : 0.4 }}
    >
      <p className="text-sm sm:text-base text-white/60 uppercase tracking-widest font-medium">
        Why VerifyMzansi?
      </p>
      {props.map((item, i) => (
        <motion.div
          key={item.text}
          className="flex items-center gap-3"
          initial={noMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={noMotion ? { duration: 0 } : { delay: 0.3 + i * 0.6, ...SPRING }}
        >
          <ShieldCheck className={`h-5 w-5 sm:h-6 sm:w-6 ${item.accent}`} />
          <span className="font-display text-lg sm:text-2xl lg:text-3xl font-bold text-white">
            {item.text}
          </span>
        </motion.div>
      ))}
    </motion.div>
  );
}

function MarketplaceShowcase({ noMotion }: { noMotion: boolean }) {
  const areas = [
    {
      icon: ShieldCheck,
      label: "Mzansi Market",
      desc: "Classifieds",
      color: "bg-brand-green/20 text-brand-green-400 border-brand-green/30",
    },
    {
      icon: Store,
      label: "Mzansi Business",
      desc: "Businesses",
      color: "bg-brand-gold/20 text-brand-gold-400 border-brand-gold/30",
    },
    {
      icon: Briefcase,
      label: "Tourism & Events",
      desc: "Campaigns",
      color: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    },
  ];

  return (
    <motion.div
      className="flex flex-col items-center gap-5 sm:gap-8"
      initial={noMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={noMotion ? undefined : { opacity: 0 }}
      transition={{ duration: noMotion ? 0 : 0.4 }}
    >
      <p className="text-sm sm:text-base text-white/60 uppercase tracking-widest font-medium">
        Three Connected Spaces
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 lg:gap-8">
        {areas.map((area, i) => (
          <motion.div
            key={area.label}
            className="flex flex-col items-center gap-3"
            initial={noMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={noMotion ? { duration: 0 } : { delay: 0.3 + i * 0.4, ...SPRING }}
          >
            <div
              className={`flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border backdrop-blur-sm ${area.color}`}
            >
              <area.icon className="h-8 w-8 sm:h-10 sm:w-10" />
            </div>
            <div className="text-center">
              <p className="font-display text-sm sm:text-base font-bold text-white">{area.label}</p>
              <p className="text-xs sm:text-sm text-white/50">{area.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function TrustShieldAnimation({ noMotion }: { noMotion: boolean }) {
  const steps = [
    { icon: Smartphone, label: "Phone", position: "-top-2 -left-2 sm:-top-3 sm:-left-3" },
    { icon: CreditCard, label: "ID Doc", position: "-top-2 -right-2 sm:-top-3 sm:-right-3" },
    { icon: ScanFace, label: "Selfie", position: "-bottom-2 -left-2 sm:-bottom-3 sm:-left-3" },
    { icon: MapPin, label: "Location", position: "-bottom-2 -right-2 sm:-bottom-3 sm:-right-3" },
  ];

  return (
    <motion.div
      className="flex flex-col items-center gap-5 sm:gap-8"
      initial={noMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={noMotion ? undefined : { opacity: 0 }}
      transition={{ duration: noMotion ? 0 : 0.4 }}
    >
      <p className="text-sm sm:text-base text-white/60 uppercase tracking-widest font-medium">
        KYC Verification
      </p>

      <div className="relative">
        {/* Central shield */}
        <motion.div
          className="flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-brand-green/20 border-2 border-brand-green/40 shadow-trust-verified"
          initial={noMotion ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={noMotion ? { duration: 0 } : SPRING}
        >
          <ShieldCheck className="h-12 w-12 sm:h-16 sm:w-16 text-brand-green-400" />
        </motion.div>

        {/* KYC step badges */}
        {steps.map((step, i) => (
          <motion.div
            key={step.label}
            className={`absolute ${step.position} flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20`}
            initial={noMotion ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={noMotion ? { duration: 0 } : { delay: 0.4 + i * 0.3, ...SPRING }}
          >
            <step.icon className="h-3.5 w-3.5 text-brand-gold-400" />
            <span className="text-xs font-semibold text-white whitespace-nowrap">{step.label}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        className="font-display text-base sm:text-xl font-bold text-white text-center"
        initial={noMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={noMotion ? { duration: 0 } : { delay: 1.6, duration: 0.5 }}
      >
        4-Step Identity Verification
      </motion.p>
    </motion.div>
  );
}

function CallToAction({ noMotion }: { noMotion: boolean }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-4 sm:gap-6"
      initial={noMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={noMotion ? undefined : { opacity: 0, transition: { duration: 0.5 } }}
      transition={{ duration: noMotion ? 0 : 0.4 }}
    >
      <motion.p
        className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold text-white text-center leading-tight"
        initial={noMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={noMotion ? { duration: 0 } : { duration: 0.6 }}
      >
        Join <span className="text-white">VerifyMzansi</span> Today
      </motion.p>

      <motion.p
        className="text-sm sm:text-lg text-white/70 text-center max-w-md"
        initial={noMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={noMotion ? { duration: 0 } : { delay: 0.3, duration: 0.5 }}
      >
        Buy &amp; sell with people you can trust
      </motion.p>

      <motion.div
        className="px-6 py-2.5 sm:px-8 sm:py-3 rounded-full bg-brand-green text-white font-bold text-base sm:text-lg shadow-[0_0_40px_-10px_rgba(22,163,74,0.6)] animate-pulse-soft"
        initial={noMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={noMotion ? { duration: 0 } : { delay: 0.6, ...SPRING }}
      >
        Register Now
      </motion.div>
    </motion.div>
  );
}

/* ── Main Component ── */

const PHASE_COMPONENTS = [
  LogoEntrance,
  ValuePropsReveal,
  MarketplaceShowcase,
  TrustShieldAnimation,
  CallToAction,
];

export function PromoVideoSlide({ className }: { className?: string }) {
  const [phase, setPhase] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPhase((prev) => (prev + 1) % PHASE_DURATIONS.length);
    }, PHASE_DURATIONS[phase]);
    return () => clearTimeout(timeout);
  }, [phase]);

  const PhaseComponent = PHASE_COMPONENTS[phase];

  return (
    <div
      role="img"
      aria-label="VerifyMzansi promotional animation: South Africa's trusted verification-first marketplace with KYC verification, three connected marketplace areas, and POPIA compliance"
      className={`relative w-full h-full overflow-hidden bg-warm-950 ${className || ""}`}
    >
      {/* Animated gradient blobs — hidden on mobile to avoid GPU-intensive blur compositing */}
      <motion.div
        className="absolute -top-1/4 -left-1/4 w-[60%] h-[60%] rounded-full bg-brand-green/15 blur-[120px] hidden sm:block"
        animate={reducedMotion ? {} : { x: ["0%", "15%", "0%"], y: ["0%", "10%", "0%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -top-1/4 -right-1/4 w-[50%] h-[50%] rounded-full bg-brand-gold/12 blur-[100px] hidden sm:block"
        animate={reducedMotion ? {} : { x: ["0%", "-10%", "0%"], y: ["0%", "15%", "0%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-1/4 left-1/4 w-[45%] h-[45%] rounded-full bg-brand-blue/10 blur-[100px] hidden sm:block"
        animate={reducedMotion ? {} : { x: ["0%", "12%", "0%"], y: ["0%", "-10%", "0%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Grain texture overlay */}
      <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay pointer-events-none" />

      {/* Phase content */}
      <div className="absolute inset-0 flex items-center justify-center px-4 sm:px-8 z-10">
        <AnimatePresence mode="wait">
          <PhaseComponent key={phase} noMotion={reducedMotion} />
        </AnimatePresence>
      </div>

      {/* Bottom SA flag stripe */}
      <div className="absolute bottom-0 inset-x-0 h-1 flex">
        <div className="flex-1 bg-brand-green" />
        <div className="flex-1 bg-black" />
        <div className="flex-1 bg-brand-gold" />
        <div className="flex-1 bg-white" />
        <div className="flex-1 bg-brand-blue" />
        <div className="flex-1 bg-brand-red" />
      </div>
    </div>
  );
}
