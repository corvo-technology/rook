import { describe, expect, it } from "vitest";
import { computerResourcesFromDockerStats } from "./supervisor-logic.js";

describe("computer resources from Docker stats", () => {
  it("reads cumulative CPU and network, memory without cache, and the disk size", () => {
    expect(
      computerResourcesFromDockerStats(
        {
          cpu_stats: { cpu_usage: { total_usage: 2_500_000_000 } },
          memory_stats: { usage: 1000, stats: { inactive_file: 300 } },
          networks: {
            eth0: { rx_bytes: 10, tx_bytes: 20 },
            eth1: { rx_bytes: 1, tx_bytes: 2 },
          },
        },
        4096,
      ),
    ).toEqual({
      cpuSeconds: 2.5,
      memoryBytes: 700,
      diskBytes: 4096,
      networkRxBytes: 11,
      networkTxBytes: 22,
    });
  });

  it("falls back to the older cache field and omits what is missing", () => {
    expect(
      computerResourcesFromDockerStats({ memory_stats: { usage: 500, stats: { cache: 100 } } }),
    ).toEqual({ memoryBytes: 400 });
    expect(computerResourcesFromDockerStats({})).toEqual({});
  });
});
