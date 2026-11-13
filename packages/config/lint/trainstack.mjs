const toolDirectives = [/^\/\s*<reference\s/, /^\s*@ts-(check|expect-error)\b/];

const noComments = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow comments. Say it with a name, a type or a test instead." },
    messages: {
      comment: "Comments are not allowed. Say it with a name, a type or a test instead.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (toolDirectives.some((directive) => directive.test(comment.value))) continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};

const relativeSpecifier = /^\.{1,2}\//;
const fileExtension = /\.[cm]?[jt]sx?$|\.json$/;

const relativeImportExtensions = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the file extension on a relative import, so Node can load the package's source without a bundler.",
    },
    messages: {
      missing: "Name the file with its extension, such as {{specifier}}.ts, so Node can load it.",
    },
  },
  create(context) {
    function check(source) {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (!relativeSpecifier.test(source.value) || fileExtension.test(source.value)) return;
      context.report({ node: source, messageId: "missing", data: { specifier: source.value } });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

export default {
  meta: { name: "trainstack" },
  rules: { "no-comments": noComments, "relative-import-extensions": relativeImportExtensions },
};
