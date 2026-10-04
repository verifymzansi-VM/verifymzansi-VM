import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { fetchManagementApi } from "./lib/supabase-management";
import reviewData from "./security-reviews/supabase-controls.json";
import {
  SECURITY_CONTROL_QUERY,
  classifySecurityLint,
  inspectSecurityControls,
  type SecurityControlReview,
} from "./lib/supabase-security-controls";

const controlReview = reviewData as SecurityControlReview;

type Args = {
  envFile: string | null;
  json: boolean;
  strict: boolean;
  failOnPlanBlocked: boolean;
  projectRef: string | null;
};

type ProjectResponse = {
  ref: string;
  name: string;
  organization_id: string;
};

type OrganizationResponse = {
  id: string;
  name: string;
  plan: string;
};

type AuthConfigResponse = {
  password_hibp_enabled?: boolean;
};

type SecurityAdvisorResponse = {
  lints?: AdvisorLint[];
};

type AdvisorLint = {
  name: string;
  title: string;
  level: string;
  categories?: string[];
  description?: string;
  detail?: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
};

type ClassifiedLint = {
  lint: AdvisorLint;
  state: "actionable" | "plan-blocked" | "reviewed-control";
  reason: string;
};

function printUsage(): void {
  console.log("");
  console.log("Check Supabase Security Advisor findings for the current project");
  console.log("");
  console.log(
    "Usage: pnpm supabase:advisor:security -- [--env-file=.env.local] [--project-ref=<ref>] [--json] [--strict] [--fail-on-plan-blocked]"
  );
  console.log("Example: pnpm supabase:advisor:security -- --strict");
  console.log("");
}

function takeOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    envFile: null,
    json: false,
    strict: false,
    failOnPlanBlocked: false,
    projectRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--env-file") {
      args.envFile = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      args.envFile = arg.slice("--env-file=".length);
      continue;
    }

    if (arg === "--project-ref") {
      args.projectRef = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--project-ref=")) {
      args.projectRef = arg.slice("--project-ref=".length);
      continue;
    }

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--fail-on-plan-blocked") {
      args.failOnPlanBlocked = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadEnvFile(envFile: string | null): Promise<void> {
  loadEnvConfig(process.cwd());

  const candidateFiles = envFile ? [envFile] : [".env.local", ".env"];

  for (const candidateFile of candidateFiles) {
    const resolvedPath = path.isAbsolute(candidateFile)
      ? candidateFile
      : path.join(process.cwd(), candidateFile);

    let content: string;
    try {
      content = await readFile(resolvedPath, "utf8");
    } catch (error) {
      if (
        !envFile &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }

    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function resolveProjectRef(explicitRef: string | null): string {
  if (explicitRef) {
    return explicitRef;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";

  if (!supabaseUrl) {
    throw new Error(
      "Missing Supabase project reference. Set NEXT_PUBLIC_SUPABASE_URL or pass --project-ref=<ref>."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid http(s) URL.");
  }

  const hostname = parsedUrl.hostname;
  const ref = hostname.split(".")[0]?.trim();
  if (!ref) {
    throw new Error("Could not derive project ref from NEXT_PUBLIC_SUPABASE_URL.");
  }

  return ref;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = resolveProjectRef(args.projectRef);

  const [project, authConfig, securityAdvisor, metadata] = await Promise.all([
    fetchManagementApi<ProjectResponse>(accessToken, `/projects/${projectRef}`),
    fetchManagementApi<AuthConfigResponse>(accessToken, `/projects/${projectRef}/config/auth`),
    fetchManagementApi<SecurityAdvisorResponse>(
      accessToken,
      `/projects/${projectRef}/advisors/security`
    ),
    fetchManagementApi<Array<{ controls: unknown }>>(
      accessToken,
      `/projects/${projectRef}/database/query`,
      { method: "POST", body: JSON.stringify({ query: SECURITY_CONTROL_QUERY, read_only: true }) }
    ),
  ]);

  const organization = await fetchManagementApi<OrganizationResponse>(
    accessToken,
    `/organizations/${project.organization_id}`
  );

  const rawLints = securityAdvisor.lints;
  if (
    !Array.isArray(rawLints) ||
    rawLints.some(
      (lint) =>
        !lint ||
        typeof lint.name !== "string" ||
        !lint.name ||
        typeof lint.title !== "string" ||
        !["INFO", "WARN", "ERROR"].includes(lint.level)
    )
  )
    throw new Error("Malformed Security Advisor response");
  const controls = Array.isArray(metadata) ? metadata[0]?.controls : undefined;
  const attestation = inspectSecurityControls(controls, controlReview);
  const classifiedLints: ClassifiedLint[] = rawLints.map((lint) => ({
    ...classifySecurityLint(lint, organization.plan, controls, controlReview),
    lint,
  }));
  const actionable = classifiedLints.filter((lint) => lint.state === "actionable");
  const planBlocked = classifiedLints.filter((lint) => lint.state === "plan-blocked");
  const reviewedControls = classifiedLints.filter((lint) => lint.state === "reviewed-control");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          project: {
            ref: project.ref,
            name: project.name,
          },
          organization: {
            id: organization.id,
            name: organization.name,
            plan: organization.plan,
          },
          auth: {
            passwordHibpEnabled: authConfig.password_hibp_enabled ?? false,
          },
          summary: {
            total: classifiedLints.length,
            actionable: actionable.length,
            planBlocked: planBlocked.length,
            reviewedControls: reviewedControls.length,
          },
          controlReview: { reviewedAt: controlReview.reviewedAt, errors: attestation.errors },
          findings: classifiedLints.map((item) => ({
            name: item.lint.name,
            title: item.lint.title,
            level: item.lint.level,
            state: item.state,
            reason: item.reason,
            remediation: item.lint.remediation ?? null,
            detail: item.lint.detail ?? null,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(`Supabase project: ${project.name} (${project.ref})`);
    console.log(`Organization plan: ${organization.plan}`);
    console.log(
      `Leaked password protection enabled: ${authConfig.password_hibp_enabled ? "yes" : "no"}`
    );
    console.log("");

    if (classifiedLints.length === 0) {
      console.log("Security Advisor reports no current security findings.");
    } else {
      console.log(
        `Security Advisor findings: ${classifiedLints.length} total (${actionable.length} actionable, ${planBlocked.length} plan-blocked, ${reviewedControls.length} reviewed controls)`
      );

      for (const item of classifiedLints) {
        console.log("");
        console.log(`[${item.state.toUpperCase()}] ${item.lint.title} (${item.lint.name})`);
        console.log(`Level: ${item.lint.level}`);
        console.log(`Reason: ${item.reason}`);
        if (item.lint.detail) {
          console.log(`Detail: ${item.lint.detail}`);
        }
        if (item.lint.remediation) {
          console.log(`Remediation: ${item.lint.remediation}`);
        }
      }
    }
  }

  for (const error of attestation.errors) console.error(`Control verification failed: ${error}`);
  if (!args.json && reviewedControls.length)
    console.warn(
      `WARN: ${reviewedControls.length} intentional control findings remain visible with exact metadata/source attestation`
    );

  const shouldFail =
    (args.strict &&
      (actionable.length > 0 || planBlocked.length > 0 || attestation.errors.length > 0)) ||
    (args.failOnPlanBlocked && planBlocked.length > 0);

  if (shouldFail) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Supabase Security Advisor check failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
