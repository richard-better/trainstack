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

export default {
  meta: { name: "trainstack" },
  rules: { "no-comments": noComments },
};
