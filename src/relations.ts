import type { Entity } from "./entity.js";
import type { EntityClass, RelationDef } from "./schema.js";

export const hasMany = (
  target: () => EntityClass<Entity>,
  foreignKey: string,
  localKey = "id",
): RelationDef => ({ kind: "hasMany", target, foreignKey, localKey });

export const hasOne = (
  target: () => EntityClass<Entity>,
  foreignKey: string,
  localKey = "id",
): RelationDef => ({ kind: "hasOne", target, foreignKey, localKey });

/**
 * `foreignKey` is the column on *this* entity that holds the id of the target.
 * E.g. `Post.belongsTo(User, 'authorId')` — post.authorId → user.id.
 */
export const belongsTo = (
  target: () => EntityClass<Entity>,
  foreignKey: string,
  targetKey = "id",
): RelationDef => ({
  kind: "belongsTo",
  target,
  foreignKey,
  localKey: targetKey,
});
