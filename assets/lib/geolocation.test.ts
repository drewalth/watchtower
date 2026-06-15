import { describe, expect, it, vi } from "vitest";

import {
  getCurrentCoords,
  isGeolocationSupported,
  queryPermission,
} from "./geolocation";

function nav(partial: Partial<Navigator>): Navigator {
  return partial as unknown as Navigator;
}

describe("isGeolocationSupported", () => {
  it("is false when the navigator has no geolocation", () => {
    expect(isGeolocationSupported(nav({}))).toBe(false);
  });

  it("is true when geolocation is present", () => {
    expect(
      isGeolocationSupported(nav({ geolocation: {} as Geolocation })),
    ).toBe(true);
  });
});

describe("queryPermission", () => {
  it("returns 'unsupported' when the permissions API is missing", async () => {
    await expect(queryPermission(nav({}))).resolves.toBe("unsupported");
  });

  it("returns the state reported by permissions.query", async () => {
    const query = vi.fn(async () => ({ state: "granted" }) as PermissionStatus);
    await expect(
      queryPermission(
        nav({ permissions: { query } as unknown as Permissions }),
      ),
    ).resolves.toBe("granted");
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
  });

  it("returns 'unsupported' when query throws (name unsupported)", async () => {
    const query = vi.fn(async () => {
      throw new TypeError("unsupported permission name");
    });
    await expect(
      queryPermission(
        nav({ permissions: { query } as unknown as Permissions }),
      ),
    ).resolves.toBe("unsupported");
  });
});

describe("getCurrentCoords", () => {
  it("resolves with the longitude/latitude from the position", async () => {
    const geolocation = {
      getCurrentPosition: (success: PositionCallback) =>
        success({
          coords: { longitude: -120.5, latitude: 38.5 },
        } as GeolocationPosition),
    } as unknown as Geolocation;

    await expect(getCurrentCoords(nav({ geolocation }))).resolves.toEqual({
      longitude: -120.5,
      latitude: 38.5,
    });
  });

  it("rejects when geolocation reports an error", async () => {
    const geolocation = {
      getCurrentPosition: (
        _success: PositionCallback,
        error: PositionErrorCallback,
      ) => error({ code: 1, message: "denied" } as GeolocationPositionError),
    } as unknown as Geolocation;

    await expect(getCurrentCoords(nav({ geolocation }))).rejects.toMatchObject({
      code: 1,
    });
  });

  it("rejects when geolocation is unavailable", async () => {
    await expect(getCurrentCoords(nav({}))).rejects.toBeInstanceOf(Error);
  });
});
