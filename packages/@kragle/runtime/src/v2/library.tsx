import * as t from "../type-system/index.js";
import {
  validateLibraryExportName,
  validateLibraryName,
} from "./validate-names.js";

export class Library<M extends t.KragleTypeRecord = {}> {
  constructor(readonly name: string, members: M) {
    validateLibraryName(name);

    const canonicalizedExports: Record<string, t.KragleType> = {};
    for (const [exportName, type] of Object.entries(members)) {
      validateLibraryExportName(name, exportName);
      canonicalizedExports[exportName] = type.canonicalize();
    }
    this.exports = canonicalizedExports;
  }

  readonly exports: t.KragleTypeRecord;
}

export type InferNamespaceMembers<L extends Library> = L extends Library<
  infer M
>
  ? t.UnwrapRecord<M>
  : {};
