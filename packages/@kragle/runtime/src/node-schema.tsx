import * as $Object from "@pschiffmann/std/object";
import { ComponentType, PropsWithChildren, ReactElement } from "react";
import { NodeJson } from "./scene-document/index.js";
import * as t from "./type-system/index.js";
import { isInputId } from "./util/kragle-identifier.js";

interface NodeSchemaInit<
  I extends t.KragleTypeRecord = {},
  O extends t.KragleTypeRecord = {},
  S extends SlotSchemas = {}
> {
  readonly inputs?: I;
  readonly outputs?: O;
  readonly slots?: S;
}

export class NodeSchema<
  I extends t.KragleTypeRecord = {},
  O extends t.KragleTypeRecord = {},
  S extends SlotSchemas = {}
> {
  constructor(
    readonly name: string,
    init: NodeSchemaInit<I, O, S>
    // | (<
    //     TypeVariable1,
    //     TypeVariable2,
    //     TypeVariable3,
    //     TypeVariable4,
    //     TypeVariable5,
    //     TypeVariable6,
    //     TypeVariable7,
    //     TypeVariable8
    //   >(
    //     t1: t.Entity<TypeVariable1>,
    //     t2: t.Entity<TypeVariable2>,
    //     t3: t.Entity<TypeVariable3>,
    //     t4: t.Entity<TypeVariable4>,
    //     t5: t.Entity<TypeVariable5>,
    //     t6: t.Entity<TypeVariable6>,
    //     t7: t.Entity<TypeVariable7>,
    //     t8: t.Entity<TypeVariable8>
    //   ) => NodeSchemaInit<I, O, S>)
  ) {
    const { inputs, outputs, slots } = init; // as NodeSchemaInit<I, O, S>;
    this.inputs = $Object.map(inputs ?? {}, (_, type: t.KragleType) =>
      type.canonicalize()
    );
    this.outputs = $Object.map(outputs ?? {}, (_, type: t.KragleType) =>
      type.canonicalize()
    );
    this.slots = $Object.map(slots ?? {}, (_, { inputs, outputs }) => ({
      inputs: inputs && $Object.map(inputs, (_, type) => type.canonicalize()),
      outputs:
        outputs && $Object.map(outputs, (_, type) => type.canonicalize()),
    }));

    const allInputs = new Set<string>();
    function validateInputName(inputName: string) {
      if (!isInputId(inputName)) {
        throw new Error(`Invalid input id: ${inputName}`);
      }
      if (allInputs.has(inputName)) {
        throw new Error(`Duplicate input id: ${inputName}`);
      }
      allInputs.add(inputName);
    }

    Object.keys(inputs ?? {}).forEach(validateInputName);
    Object.values(slots ?? {})
      .flatMap((slot) => Object.keys(slot.inputs ?? {}))
      .forEach(validateInputName);
  }

  readonly inputs: t.KragleTypeRecord;
  readonly outputs: t.KragleTypeRecord;
  readonly slots: SlotSchemas;
  readonly validate?: ValidateNode;

  /**
   * Map from collection input name to slot name.
   */
  #collectionInputSources = new Map<string, string>();

  *getCollectionInputs(): Iterable<[inputName: string, type: t.KragleType]> {
    for (const slotSchema of Object.values(this.slots)) {
      if (slotSchema.inputs) yield* Object.entries(slotSchema.inputs);
    }
  }

  *getCollectionSlots(): Iterable<string> {
    for (const [slotName, slotSchema] of Object.entries(this.slots)) {
      if (slotSchema.inputs) yield slotName;
    }
  }

  isCollectionSlot(slotName: string): boolean {
    const slotSchema = this.slots[slotName];
    if (slotSchema) return !!slotSchema.inputs;
    throw new Error(`Slot '${slotName}' doesn't exist on type '${this.name}'.`);
  }

  isCollectionInput(inputName: string): boolean {
    if (this.inputs.hasOwnProperty(inputName)) return false;
    for (const slotSchema of Object.values(this.slots)) {
      if (slotSchema.inputs?.hasOwnProperty(inputName)) return true;
    }
    throw new Error(
      `Input '${inputName}' doesn't exist on type '${this.name}'.`
    );
  }
}

/**
 * This callback can be used to implement custom validation logic. It is only
 * called if `nodeJson` has passed the type system based validation.
 */
export type ValidateNode = (nodeJson: NodeJson) => string | null;

//
// Slots
//

export interface SlotSchema {
  /**
   * If a slot schema has an `inputs` key (even if it is empty), then that slot
   * is a collection slot and can accept any number of children, including 0.
   */
  readonly inputs?: t.KragleTypeRecord;
  readonly outputs?: t.KragleTypeRecord;
}

export type SlotSchemas = Readonly<Record<string, SlotSchema>>;

/**
 * Usage:
 * ```ts
 * const slots = {
 *   slotX: {
 *     inputs: {
 *       a: t.string(),
 *       b: t.optional(t.number()),
 *     },
 *   },
 *   slotY: {
 *     inputs: {
 *       a: t.null(),
 *       c: t.boolean(),
 *     },
 *   },
 * };
 *
 * type T1 = UnwrapAllSlotInputs<typeof slots>;
 * // type T1 = {
 * //   readonly slotX: {
 * //       readonly a: readonly string[];
 * //       readonly b: readonly (number | undefined)[];
 * //   };
 * //   readonly slotY: {
 * //       readonly a: readonly null[];
 * //       readonly c: readonly boolean[];
 * //   };
 * // }
 * ```
 */
type UnwrapAllSlotInputs<S extends SlotSchemas> = {
  readonly [k in keyof S]: UnwrapSingleSlotInputs<S[k]["inputs"]>;
};
type UnwrapSingleSlotInputs<I extends t.KragleTypeRecord | undefined> =
  I extends t.KragleTypeRecord
    ? { readonly [k in keyof I]: readonly t.Unwrap<I[k]>[] }
    : {};

type NestedKeys<T extends {}> = {
  [k in keyof T]: keyof T[k] & string;
}[keyof T];
type Flatten<T extends Record<string, {}>> = {
  readonly [k in NestedKeys<T>]: T[keyof T][k];
};

type AddKeys<T extends {}, K extends string> = {
  [k in K]: k extends keyof T ? T[k] : never;
};
type AddNestedKeys<T extends Record<string, {}>, K extends string> = {
  [k in keyof T]: AddKeys<T[k], K>;
};

// TODO: Explain this magic
type FlattenSlotInputs<S extends SlotSchemas> = Flatten<
  AddNestedKeys<UnwrapAllSlotInputs<S>, NestedKeys<UnwrapAllSlotInputs<S>>>
>;

//
// React component props
//

export type InferProps<N extends NodeSchema> = N extends NodeSchema<
  infer I,
  infer O,
  infer S
>
  ? t.UnwrapRecord<I> &
      FlattenSlotInputs<S> &
      SlotPropMixin<S> &
      OutputsProviderPropMixin<O>
  : {};

type SlotPropMixin<S extends SlotSchemas> = keyof S extends never
  ? {}
  : {
      readonly slots: {
        readonly [slotName in keyof S]: S[slotName]["inputs"] extends {}
          ? readonly SlotPropValue<S[slotName]>[]
          : SlotPropValue<S[slotName]>;
      };
    };

type SlotPropValue<S extends SlotSchema> = {
  readonly nodeId: string;
  readonly element: S["outputs"] extends {}
    ? (
        o: { readonly key?: string } & t.UnwrapRecord<S["outputs"]>
      ) => ReactElement
    : (o?: { readonly key?: string }) => ReactElement;
};

type OutputsProviderPropMixin<O extends t.KragleTypeRecord> =
  keyof O extends never
    ? {}
    : { OutputsProvider: ComponentType<PropsWithChildren<t.UnwrapRecord<O>>> };
