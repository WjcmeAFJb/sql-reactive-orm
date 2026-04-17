import { Entity, belongsTo, hasMany, integer, primary, text } from "../../src/index.js";
import type { EntitySchema } from "../../src/index.js";

export class User extends Entity {
  static schema: EntitySchema = {
    name: "User",
    table: "users",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
      email: text({ unique: true }),
      age: integer({ nullable: true }),
    },
    relations: {
      posts: hasMany(() => Post, "authorId"),
    },
  };
  declare id: number;
  declare name: Promise<string>;
  declare email: Promise<string>;
  declare age: Promise<number | null>;
  declare posts: Promise<Post[]>;
}

export class Post extends Entity {
  static schema: EntitySchema = {
    name: "Post",
    table: "posts",
    primaryKey: "id",
    fields: {
      id: primary(),
      title: text(),
      body: text({ nullable: true }),
      authorId: integer(),
    },
    relations: {
      author: belongsTo(() => User, "authorId"),
      comments: hasMany(() => Comment, "postId"),
    },
  };
  declare id: number;
  declare title: Promise<string>;
  declare body: Promise<string | null>;
  declare authorId: Promise<number>;
  declare author: Promise<User | null>;
  declare comments: Promise<Comment[]>;
}

export class Comment extends Entity {
  static schema: EntitySchema = {
    name: "Comment",
    table: "comments",
    primaryKey: "id",
    fields: {
      id: primary(),
      postId: integer(),
      body: text(),
    },
    relations: {
      post: belongsTo(() => Post, "postId"),
    },
  };
  declare id: number;
  declare postId: Promise<number>;
  declare body: Promise<string>;
  declare post: Promise<Post | null>;
}
