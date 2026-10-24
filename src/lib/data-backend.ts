/** Compiled with the app. Changing backend requires a rebuilt, verified release. */
export function getDataBackend(): "source" | "foundation" {
  const mode = process.env.NEXT_PUBLIC_DATA_BACKEND ?? "source";
  if (mode !== "source" && mode !== "foundation")
    throw new Error("Application backend configuration is invalid");
  return mode;
}
