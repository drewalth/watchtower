/**
 * Pure, injectable wrappers around the browser geolocation/permissions APIs.
 * Each takes `navigator` as an argument so the logic is testable in the node
 * test env with plain stub objects — no DOM required.
 */

export type Coords = { longitude: number; latitude: number };

/** Permission state, plus a sentinel for browsers without the Permissions API. */
export type GeolocationPermission = PermissionState | "unsupported";

/** True when the browser exposes the geolocation API (the gate for the control). */
export function isGeolocationSupported(nav: Navigator): boolean {
  return "geolocation" in nav && nav.geolocation != null;
}

/**
 * Query the current geolocation permission without prompting. Returns
 * "unsupported" when the Permissions API is absent or rejects the query name
 * (some browsers throw rather than report support).
 */
export async function queryPermission(
  nav: Navigator,
): Promise<GeolocationPermission> {
  const query = nav.permissions?.query;
  if (!query) return "unsupported";
  try {
    const status = await query.call(nav.permissions, {
      name: "geolocation" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

/** Promisified `getCurrentPosition`; rejects on error or when unavailable. */
export function getCurrentCoords(nav: Navigator): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported(nav)) {
      reject(new Error("Geolocation is not supported"));
      return;
    }
    nav.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          longitude: pos.coords.longitude,
          latitude: pos.coords.latitude,
        }),
      (err) => reject(err),
    );
  });
}
