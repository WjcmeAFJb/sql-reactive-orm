import { defineConfig } from "vitepress";

// Published at https://WjcmeAFJb.github.io/sql-reactive-orm/ — override via
// DOCS_BASE if you're hosting elsewhere.
const base = process.env.DOCS_BASE ?? "/sql-reactive-orm/";

export default defineConfig({
  title: "sql-reactive-orm",
  description:
    "Reactive ORM for SQLite built on MobX. Promises as fields, React use()-native.",
  base,
  lastUpdated: true,
  cleanUrls: true,
  head: [
    [
      "meta",
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
    ],
  ],
  themeConfig: {
    siteTitle: "sql-reactive-orm",
    outline: { level: [2, 3] },
    search: { provider: "local" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts/reactivity" },
      { text: "API", link: "/api/orm" },
      { text: "Demo", link: `${base}demo/`, target: "_blank" },
      {
        text: "GitHub",
        link: "https://github.com/WjcmeAFJb/sql-reactive-orm",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Quickstart", link: "/guide/quickstart" },
            { text: "Integration with sql-git", link: "/guide/sql-git" },
            { text: "Codegen", link: "/guide/codegen" },
          ],
        },
      ],
      "/concepts/": [
        {
          text: "Concepts",
          items: [
            { text: "Reactivity model", link: "/concepts/reactivity" },
            { text: "Identity map", link: "/concepts/identity-map" },
            { text: "Entities & relations", link: "/concepts/entities" },
            { text: "Aggregate queries", link: "/concepts/aggregates" },
            { text: "Drivers", link: "/concepts/drivers" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API reference",
          items: [
            { text: "Orm", link: "/api/orm" },
            { text: "Entity", link: "/api/entity" },
            { text: "Query / SqlQuery", link: "/api/queries" },
            { text: "Driver", link: "/api/driver" },
            { text: "Schema helpers", link: "/api/schema" },
          ],
        },
      ],
    },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/WjcmeAFJb/sql-reactive-orm",
      },
    ],
    footer: {
      message:
        "Released under the project's terms — see repository LICENSE.",
      copyright: "© 2026 sql-reactive-orm contributors",
    },
  },
});
