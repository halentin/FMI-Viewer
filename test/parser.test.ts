import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseFmu, FmuData } from "../src/fmuParser";

const FIXTURES = path.join(__dirname, "..", "test", "fixtures");

function fmu(version: string, name: string): string {
  return path.join(FIXTURES, version, `${name}.fmu`);
}

describe("FMI 2.0 parsing", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("2.0", "Feedthrough"));
  });

  it("parses FMI version", () => {
    assert.equal(data.fmiVersion, "2.0");
  });

  it("parses model name", () => {
    assert.equal(data.modelName, "Feedthrough");
  });

  it("parses description", () => {
    assert.ok(data.description && data.description.length > 0);
  });

  it("parses generation tool", () => {
    assert.ok(data.generationTool && data.generationTool.length > 0);
  });

  it("parses GUID", () => {
    assert.ok(data.guid && data.guid.length > 0);
  });

  it("detects platforms", () => {
    assert.ok(data.platforms.length > 0);
    // FMI 2.0 uses old-style platform names
    for (const p of data.platforms) {
      assert.ok(
        /^(darwin64|linux64|win32|win64)$/.test(p),
        `unexpected platform: ${p}`,
      );
    }
  });

  it("parses ModelExchange capabilities", () => {
    assert.ok(data.modelExchange);
    assert.ok(data.modelExchange!.modelIdentifier);
  });

  it("parses CoSimulation capabilities", () => {
    assert.ok(data.coSimulation);
    assert.ok(data.coSimulation!.modelIdentifier);
  });

  it("parses variables", () => {
    assert.ok(data.variables.length > 0);
    const v = data.variables[0];
    assert.ok(v.name.length > 0);
    assert.ok(v.valueReference !== undefined);
    assert.ok(v.type.length > 0);
  });

  it("parses variable types correctly for FMI 2.0", () => {
    const types = new Set(data.variables.map((v) => v.type));
    // FMI 2.0 Feedthrough has Real, Integer, Boolean, String, Enumeration
    assert.ok(types.has("Real"));
    assert.ok(types.has("Integer"));
    assert.ok(types.has("Boolean"));
  });

  it("parses causality", () => {
    const causalities = new Set(data.variables.map((v) => v.causality));
    assert.ok(causalities.has("input"));
    assert.ok(causalities.has("output"));
  });

  it("parses type definitions", () => {
    // Feedthrough has an Option enum
    assert.ok(data.typeDefinitions.length > 0);
    const enumDef = data.typeDefinitions.find((t) => t.name === "Option");
    assert.ok(enumDef);
    assert.equal(enumDef!.type, "Enumeration");
    assert.ok(enumDef!.items && enumDef!.items.length > 0);
  });

  it("parses default experiment", () => {
    assert.ok(data.defaultExperiment);
    assert.ok(data.defaultExperiment!.stopTime);
  });

  it("parses number of event indicators from root attribute", () => {
    // Feedthrough has numberOfEventIndicators="0" on root element
    assert.equal(typeof data.numberOfEventIndicators, "number");
  });

  it("includes zip entries", () => {
    assert.ok(data.zipEntries.length > 0);
    assert.ok(data.zipEntries.some((e) => e.startsWith("binaries/")));
    assert.ok(data.zipEntries.some((e) => e.startsWith("sources/")));
  });
});

describe("FMI 3.0 parsing", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("3.0", "Feedthrough"));
  });

  it("parses FMI version", () => {
    assert.equal(data.fmiVersion, "3.0");
  });

  it("parses model name", () => {
    assert.equal(data.modelName, "Feedthrough");
  });

  it("parses instantiation token (guid field)", () => {
    assert.ok(data.guid && data.guid.length > 0);
  });

  it("detects platforms with FMI 3.0 naming", () => {
    assert.ok(data.platforms.length > 0);
    // FMI 3.0 uses arch-os naming
    for (const p of data.platforms) {
      assert.ok(p.includes("-"), `expected arch-os format: ${p}`);
    }
  });

  it("parses CoSimulation with FMI 3.0 capabilities", () => {
    assert.ok(data.coSimulation);
    assert.ok(data.coSimulation!.modelIdentifier);
  });

  it("parses more variable types than FMI 2.0", () => {
    const types = new Set(data.variables.map((v) => v.type));
    // FMI 3.0 Feedthrough has Float32, Float64, Int8, UInt8, Int16, etc.
    assert.ok(types.has("Float64"));
    assert.ok(types.has("Float32"));
    assert.ok(types.has("Int32"));
    assert.ok(types.has("Boolean"));
    assert.ok(types.has("Binary"));
  });

  it("parses start values", () => {
    const withStart = data.variables.filter((v) => v.start !== undefined && v.start !== "");
    assert.ok(withStart.length > 0);
  });

  it("has more variables than FMI 2.0 Feedthrough", async () => {
    const fmi2 = await parseFmu(fmu("2.0", "Feedthrough"));
    assert.ok(data.variables.length > fmi2.variables.length);
  });
});

describe("FMI 3.0 ScheduledExecution", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("3.0", "Clocks"));
  });

  it("parses ScheduledExecution capabilities", () => {
    assert.ok(data.scheduledExecution);
    assert.ok(data.scheduledExecution!.modelIdentifier);
  });

  it("does not have ModelExchange or CoSimulation", () => {
    assert.equal(data.modelExchange, undefined);
    assert.equal(data.coSimulation, undefined);
  });
});

describe("FMI 2.0 BouncingBall", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("2.0", "BouncingBall"));
  });

  it("parses unit definitions", () => {
    assert.ok(data.unitDefinitions.length > 0);
    const meter = data.unitDefinitions.find((u) => u.name === "m");
    assert.ok(meter);
  });

  it("parses variables with declared types", () => {
    const withType = data.variables.filter((v) => v.declaredType);
    assert.ok(withType.length > 0);
  });

  it("has continuous states", () => {
    assert.ok(data.numberOfContinuousStates! > 0, "BouncingBall has continuous states");
  });

  it("has event indicators", () => {
    assert.ok(data.numberOfEventIndicators! > 0, "BouncingBall has event indicators");
  });
});

describe("FMI 3.0 BouncingBall", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("3.0", "BouncingBall"));
  });

  it("has continuous states from ContinuousStateDerivative elements", () => {
    assert.ok(data.numberOfContinuousStates! > 0, "BouncingBall 3.0 has continuous states");
  });

  it("has event indicators from EventIndicator elements", () => {
    assert.ok(data.numberOfEventIndicators! > 0, "BouncingBall 3.0 has event indicators");
  });
});

describe("FMI 3.0 StateSpace (arrays)", () => {
  let data: FmuData;

  before(async () => {
    data = await parseFmu(fmu("3.0", "StateSpace"));
  });

  it("parses array dimensions", () => {
    const withDims = data.variables.filter(
      (v) => v.dimensions && v.dimensions.length > 0,
    );
    assert.ok(withDims.length > 0, "StateSpace should have array variables");
  });
});

describe("error handling", () => {
  it("rejects non-existent file", async () => {
    await assert.rejects(() => parseFmu("/nonexistent/file.fmu"));
  });

  it("rejects non-zip file", async () => {
    const tmpFile = path.join(FIXTURES, "_not_a_zip.fmu");
    fs.writeFileSync(tmpFile, "this is not a zip file");
    try {
      await assert.rejects(() => parseFmu(tmpFile));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
