#!/bin/sh
# Writes the deployment's API origin into the console when the container starts, so one published
# image serves any deployment. The nginx image runs every script in /docker-entrypoint.d/ before
# nginx itself.
#
# One value, two places, filled from the same variable so they cannot disagree:
#   index.html   <meta name="rowcat-api-origin">  what the bundle calls (src/lib/api.ts)
#   nginx conf   CSP connect-src                  what the browser lets it call
#
# Both are rendered from the pristine copies the image keeps in /etc/rowcat, so a restart with a
# different value starts from the template, never from the previous run's output.
set -eu

origin="${VITE_API_ORIGIN:-$ROWCAT_DEFAULT_API_ORIGIN}"

# The value lands in HTML and an nginx directive. An origin is scheme, host and an optional port —
# anything else (a path, a quote, a space) is refused rather than escaped, and the container stops
# instead of serving a console that calls the wrong place. grep matches line by line, so a value
# with a newline would pass on its first line alone; it is refused before grep sees it.
if [ "$(printf '%s' "$origin" | wc -l)" -ne 0 ] ||
	! printf '%s' "$origin" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
	echo "rowcat-admin: VITE_API_ORIGIN must be an origin like https://api.example.com (got: $origin)" >&2
	exit 1
fi

sed "s#__API_ORIGIN__#${origin}#g" /etc/rowcat/default.conf >/etc/nginx/conf.d/default.conf
sed "s#</head>#<meta name=\"rowcat-api-origin\" content=\"${origin}\" /></head>#" \
	/etc/rowcat/index.html >/usr/share/nginx/html/index.html

echo "rowcat-admin: API origin ${origin}"
