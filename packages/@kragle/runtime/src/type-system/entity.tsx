import { ComponentType } from "react";
import { KragleType } from "./kragle-type.js";

class KragleEntity<T = unknown> extends KragleType<T> {
  constructor(
    readonly name: string,

    /**
     * If this property exists, then constant expressions of this entity type
     * can be created in the IDE.
     */
    readonly literal?: EntityLiteralSupport<T>
  ) {
    super();
  }

  protected override _isAssignableTo(other: KragleType): boolean {
    return this === other;
  }

  override toString(): string {
    return this.name;
  }
}

export interface EntityLiteralSupport<T = unknown> {
  /**
   * Returns a new entity instance for use as a `literal-expression` in the IDE.
   * `T` must be JSON-serializable.
   */
  create(): T;

  /**
   *
   * When a scene is loaded, all `"entity-literal"` expressions of this entity
   * type are passed to `validate()`. If `validate()` returns an error
   * message, then the expression is not set on the node.
   */
  validate(json: unknown): string | void;

  /**
   * Returns a human-readable description of this entity literal.
   */
  format(entity: T): string;

  /**
   * This component is rendered in the IDE to edit entity literals of this type.
   */
  Editor: ComponentType<{ value: T; onChange(value: T): void }>;
}

function kragleEntity<T>(
  name: string,
  literal?: EntityLiteralSupport<T>
): KragleEntity<T> {
  return new KragleEntity(name, literal);
}

export { KragleEntity as Entity, kragleEntity as entity };
