RTL corpus provider fixtures.

`corpus/` is a miniature stand-in for the real `<bundle>/skills` corpus (t2 lands the
real one): directory bundles (`<entry>/SKILL.md`) plus flat markdown entries, and two
deliberately invalid entries (an underscore skill name and a file without frontmatter)
that the provider must SKIP with a warning instead of failing the whole listing.
