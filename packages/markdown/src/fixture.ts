/**
 * A manuscript that both platforms are tested against. Parity cannot mean the same pixels: web
 * renders to the DOM, mobile to native views, and they share no render code. Here, parity means the
 * same meaning: titles arrive as titles, lists as lists, code as code.
 *
 * Parity is checked in three pieces: this manuscript produces the whole vocabulary
 * (fixture.test.ts), the web renderer covers it (apps/web chat-markdown.test.ts), and the mobile
 * renderer covers it (apps/mobile markdown-view.test.ts). The manuscript is shared so all three
 * tests read the same text; separate copies would let one copy miss a construct, leaving that
 * platform green while unable to draw it.
 */
export const CHAT_MARKDOWN_FIXTURE = `# Chapter 1 · At the Door

The door opens slowly.
A cold wind blows into the room.

## Entrance

**Bold** and *italic*, and ***both***. ~~Struck text~~ and \`inline code\`.

> A memory.
>> A memory within it.

- one
- two
  - under two
    - under that

1. first
2. second

- [ ] todo
- [x] done

| name | value |
| --- | ---: |
| alpha | 10 |
| beta | 20 |

\`\`\`ts
const value = 123;
\`\`\`

[example](https://example.com "Title") and an autolink https://example.com/article

![cat](https://example.com/cat.png "cat")

https://example.com/cat.png

\\*literal asterisks\\*

---
`;
