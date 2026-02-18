import * as yauzl from "yauzl";
import * as sax from "sax";

export interface Variable {
  name: string;
  valueReference: string;
  type: string;
  causality?: string;
  variability?: string;
  initial?: string;
  start?: string;
  description?: string;
  unit?: string;
  declaredType?: string;
  dimensions?: string[];
}

export interface TypeDefinition {
  name: string;
  type: string;
  items?: { name: string; value: string; description?: string }[];
}

export interface UnitDefinition {
  name: string;
  baseUnit?: Record<string, string>;
  displayUnits?: {
    name: string;
    factor?: string;
    offset?: string;
    inverse?: string;
  }[];
}

export interface FmuData {
  fmiVersion: string;
  modelName: string;
  description?: string;
  author?: string;
  version?: string;
  copyright?: string;
  license?: string;
  generationTool?: string;
  generationDateAndTime?: string;
  guid?: string;
  variableNamingConvention?: string;
  numberOfEventIndicators?: number;
  numberOfContinuousStates?: number;

  modelExchange?: Record<string, string>;
  coSimulation?: Record<string, string>;
  scheduledExecution?: Record<string, string>;

  platforms: string[];
  variables: Variable[];
  typeDefinitions: TypeDefinition[];
  defaultExperiment?: Record<string, string>;
  unitDefinitions: UnitDefinition[];
  zipEntries: string[];
}

// FMI 3.0 variable type element names
const FMI3_VARIABLE_TYPES = new Set([
  "Float32",
  "Float64",
  "Int8",
  "UInt8",
  "Int16",
  "UInt16",
  "Int32",
  "UInt32",
  "Int64",
  "UInt64",
  "Boolean",
  "String",
  "Binary",
  "Enumeration",
  "Clock",
]);

// FMI 2.0 type element names (children of ScalarVariable)
const FMI2_TYPE_ELEMENTS = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "Enumeration",
]);

export async function parseFmu(filePath: string): Promise<FmuData> {
  const entries = await listZipEntries(filePath);
  const xmlBuffer = await extractFile(filePath, "modelDescription.xml");
  if (!xmlBuffer) {
    throw new Error("modelDescription.xml not found in FMU");
  }

  const data = parseModelDescription(xmlBuffer.toString("utf-8"));

  // Detect platforms from binaries/ entries
  const platformDirs = new Set<string>();
  for (const entry of entries) {
    if (entry.startsWith("binaries/") && entry !== "binaries/") {
      const parts = entry.slice("binaries/".length).split("/");
      if (parts[0] && parts[0].length > 0) {
        platformDirs.add(parts[0]);
      }
    }
  }

  data.platforms = Array.from(platformDirs).sort();
  data.zipEntries = entries.filter((e) => e !== "modelDescription.xml");
  return data;
}

function listZipEntries(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error("Failed to open ZIP"));
      const entries: string[] = [];
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        entries.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

function extractFile(
  filePath: string,
  targetName: string,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error("Failed to open ZIP"));
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName === targetName) {
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2 || !stream) return reject(err2 || new Error("Failed to read stream"));
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              zipfile.close();
              resolve(Buffer.concat(chunks));
            });
            stream.on("error", reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => resolve(null));
      zipfile.on("error", reject);
    });
  });
}

function parseModelDescription(xml: string): FmuData {
  const data: FmuData = {
    fmiVersion: "",
    modelName: "",
    platforms: [],
    variables: [],
    typeDefinitions: [],
    unitDefinitions: [],
    zipEntries: [],
  };

  const parser = sax.parser(true, { trim: true });

  // Parser state
  const stack: string[] = [];
  let inModelVariables = false;
  let inTypeDefinitions = false;
  let inUnitDefinitions = false;
  let inModelStructure = false;
  let inDerivatives = false;

  // FMI 2.0 state
  let currentScalarVariable: Variable | null = null;

  // Type definition state
  let currentTypeDef: TypeDefinition | null = null;

  // Unit definition state
  let currentUnit: UnitDefinition | null = null;

  parser.onopentag = (node) => {
    const tag = node.name;
    const attrs = node.attributes as Record<string, string>;
    stack.push(tag);

    if (tag === "fmiModelDescription") {
      data.fmiVersion = attrs.fmiVersion || "";
      data.modelName = attrs.modelName || "";
      data.description = attrs.description;
      data.author = attrs.author;
      data.version = attrs.version;
      data.copyright = attrs.copyright;
      data.license = attrs.license;
      data.generationTool = attrs.generationTool;
      data.generationDateAndTime = attrs.generationDateAndTime;
      data.guid = attrs.guid || attrs.instantiationToken;
      data.variableNamingConvention = attrs.variableNamingConvention;
      if (attrs.numberOfEventIndicators) {
        data.numberOfEventIndicators = parseInt(
          attrs.numberOfEventIndicators,
          10,
        );
      }
    } else if (tag === "ModelExchange") {
      data.modelExchange = { ...attrs };
    } else if (tag === "CoSimulation") {
      data.coSimulation = { ...attrs };
    } else if (tag === "ScheduledExecution") {
      data.scheduledExecution = { ...attrs };
    } else if (tag === "DefaultExperiment") {
      data.defaultExperiment = { ...attrs };
    } else if (tag === "ModelVariables") {
      inModelVariables = true;
    } else if (tag === "TypeDefinitions") {
      inTypeDefinitions = true;
    } else if (tag === "UnitDefinitions") {
      inUnitDefinitions = true;
    } else if (tag === "ModelStructure") {
      inModelStructure = true;
    } else if (tag === "Derivatives" && inModelStructure) {
      // FMI 2.0: <ModelStructure><Derivatives><Unknown>...
      inDerivatives = true;
    }

    // ModelStructure: count states and event indicators
    if (inModelStructure) {
      if (data.fmiVersion.startsWith("2")) {
        // FMI 2.0: <Unknown> inside <Derivatives> = one continuous state each
        if (inDerivatives && tag === "Unknown") {
          data.numberOfContinuousStates =
            (data.numberOfContinuousStates || 0) + 1;
        }
      } else {
        // FMI 3.0: <ContinuousStateDerivative> = one state each
        if (tag === "ContinuousStateDerivative") {
          data.numberOfContinuousStates =
            (data.numberOfContinuousStates || 0) + 1;
        }
        // FMI 3.0: <EventIndicator> = one event indicator each
        if (tag === "EventIndicator") {
          data.numberOfEventIndicators =
            (data.numberOfEventIndicators || 0) + 1;
        }
      }
    }

    // Variables parsing
    if (inModelVariables) {
      if (data.fmiVersion.startsWith("2")) {
        // FMI 2.0: <ScalarVariable> with child type elements
        if (tag === "ScalarVariable") {
          currentScalarVariable = {
            name: attrs.name || "",
            valueReference: attrs.valueReference || "",
            type: "",
            causality: attrs.causality,
            variability: attrs.variability,
            initial: attrs.initial,
            description: attrs.description,
          };
        } else if (currentScalarVariable && FMI2_TYPE_ELEMENTS.has(tag)) {
          currentScalarVariable.type = tag;
          currentScalarVariable.start = attrs.start;
          currentScalarVariable.unit = attrs.unit;
          currentScalarVariable.declaredType = attrs.declaredType;
        }
      } else {
        // FMI 3.0: Variable type IS the element
        const parent = stack.length >= 2 ? stack[stack.length - 2] : "";
        if (parent === "ModelVariables" && FMI3_VARIABLE_TYPES.has(tag)) {
          const variable: Variable = {
            name: attrs.name || "",
            valueReference: attrs.valueReference || "",
            type: tag,
            causality: attrs.causality,
            variability: attrs.variability,
            initial: attrs.initial,
            start: attrs.start,
            description: attrs.description,
            unit: attrs.unit,
            declaredType: attrs.declaredType,
          };
          data.variables.push(variable);
        } else if (tag === "Dimension") {
          // FMI 3.0 array dimensions
          const lastVar = data.variables[data.variables.length - 1];
          if (lastVar) {
            if (!lastVar.dimensions) lastVar.dimensions = [];
            lastVar.dimensions.push(
              attrs.start || attrs.valueReference || "",
            );
          }
        } else if (tag === "Start" && data.variables.length > 0) {
          // FMI 3.0 <Start value="..."/> for String/Binary
          const lastVar = data.variables[data.variables.length - 1];
          if (lastVar && attrs.value !== undefined) {
            lastVar.start = attrs.value;
          }
        }
      }
    }

    // Type definitions
    if (inTypeDefinitions) {
      if (tag === "SimpleType") {
        // FMI 2.0
        currentTypeDef = { name: attrs.name || "", type: "", items: [] };
      } else if (tag === "EnumerationType") {
        // FMI 3.0
        currentTypeDef = {
          name: attrs.name || "",
          type: "Enumeration",
          items: [],
        };
      } else if (tag === "Enumeration" && currentTypeDef && !inModelVariables) {
        // FMI 2.0 <SimpleType><Enumeration>
        currentTypeDef.type = "Enumeration";
      } else if (tag === "Item" && currentTypeDef) {
        currentTypeDef.items!.push({
          name: attrs.name || "",
          value: attrs.value || "",
          description: attrs.description,
        });
      } else if (
        currentTypeDef &&
        !currentTypeDef.type &&
        FMI2_TYPE_ELEMENTS.has(tag)
      ) {
        currentTypeDef.type = tag;
      }
    }

    // Unit definitions
    if (inUnitDefinitions) {
      if (tag === "Unit") {
        currentUnit = { name: attrs.name || "" };
      } else if (tag === "BaseUnit" && currentUnit) {
        currentUnit.baseUnit = { ...attrs };
      } else if (tag === "DisplayUnit" && currentUnit) {
        if (!currentUnit.displayUnits) currentUnit.displayUnits = [];
        currentUnit.displayUnits.push({
          name: attrs.name || "",
          factor: attrs.factor,
          offset: attrs.offset,
          inverse: attrs.inverse,
        });
      }
    }
  };

  parser.onclosetag = (tag) => {
    if (tag === "ModelVariables") {
      inModelVariables = false;
    } else if (tag === "TypeDefinitions") {
      inTypeDefinitions = false;
    } else if (tag === "UnitDefinitions") {
      inUnitDefinitions = false;
    } else if (tag === "ModelStructure") {
      inModelStructure = false;
    } else if (tag === "Derivatives") {
      inDerivatives = false;
    }

    // FMI 2.0: push variable on ScalarVariable close
    if (tag === "ScalarVariable" && currentScalarVariable) {
      data.variables.push(currentScalarVariable);
      currentScalarVariable = null;
    }

    // Type definitions
    if (tag === "SimpleType" || tag === "EnumerationType") {
      if (currentTypeDef) {
        data.typeDefinitions.push(currentTypeDef);
        currentTypeDef = null;
      }
    }

    // Unit definitions
    if (tag === "Unit" && currentUnit) {
      data.unitDefinitions.push(currentUnit);
      currentUnit = null;
    }

    stack.pop();
  };

  parser.write(xml).close();
  return data;
}
