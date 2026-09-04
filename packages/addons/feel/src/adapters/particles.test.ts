import { describe, expect, it, vi } from "vitest";
import { createMockEntity } from "@yagejs/core";
import type {
  ParticleEmissionHandle,
  ParticleEmitterComponent,
} from "@yagejs/particles";
import { Feel } from "../Feel.js";
import { feelParticleEmit } from "./particles.js";

describe("feelParticleEmit", () => {
  it("releases only the request owned by its playback", () => {
    const { entity } = createMockEntity();
    const requests: Array<{
      active: boolean;
      release: ReturnType<typeof vi.fn>;
    }> = [];
    const emitter = {
      requestEmission: vi.fn((): ParticleEmissionHandle => {
        const request = {
          active: true,
          release: vi.fn(() => {
            request.active = false;
          }),
        };
        requests.push(request);
        return request;
      }),
    } as unknown as ParticleEmitterComponent;
    const feel = entity.add(
      new Feel({
        trail: {
          overlap: "allow",
          effect: feelParticleEmit({ emitter, duration: 1 }),
        },
      }),
    );

    const first = feel.play("trail");
    feel.play("trail");
    expect(requests).toHaveLength(2);

    first?.stop();
    expect(requests[0]?.release).toHaveBeenCalledOnce();
    expect(requests[1]?.release).not.toHaveBeenCalled();
  });

  it("holds emission until graceful release", () => {
    const { entity } = createMockEntity();
    const request = {
      active: true,
      release: vi.fn(() => {
        request.active = false;
      }),
    };
    const emitter = {
      requestEmission: vi.fn(() => request),
    } as unknown as ParticleEmitterComponent;
    const feel = entity.add(
      new Feel({ trail: feelParticleEmit({ emitter, duration: "held" }) }),
    );

    const playback = feel.play("trail");
    feel.update(1);
    expect(playback?.active).toBe(true);
    expect(request.active).toBe(true);

    playback?.release();
    expect(playback?.active).toBe(false);
    expect(request.release).toHaveBeenCalledOnce();
  });
});
