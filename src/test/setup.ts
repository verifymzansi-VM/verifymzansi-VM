import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock out `server-only` so server modules can be imported in jsdom tests
vi.mock("server-only", () => ({}));
