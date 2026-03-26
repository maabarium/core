#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Prepare a Developer ID Application .p12 export for GitHub Actions.

Usage:
	bash ./scripts/prepare-apple-certificate.sh [options] <path-to-p12>

Options:
	--copy           Copy the base64 value to the macOS clipboard with pbcopy.
	--output <path>  Write the base64 value to a file instead of stdout.
	--help           Show this help text.

Examples:
	bash ./scripts/prepare-apple-certificate.sh ~/Downloads/DeveloperIDApplication.p12
	bash ./scripts/prepare-apple-certificate.sh --copy ~/Downloads/DeveloperIDApplication.p12
	bash ./scripts/prepare-apple-certificate.sh --output /tmp/apple-certificate.b64 ~/Downloads/DeveloperIDApplication.p12

The script validates that the base64 text decodes back to the original .p12 file
before printing or copying it.
EOF
}

decode_base64() {
	local input_path="$1"
	local output_path="$2"

	if base64 --decode "$input_path" > "$output_path" 2>/dev/null; then
		return 0
	fi

	if base64 -d "$input_path" > "$output_path" 2>/dev/null; then
		return 0
	fi

	if base64 -D -i "$input_path" -o "$output_path" 2>/dev/null; then
		return 0
	fi

	return 1
}

copy_to_clipboard=false
output_path=""
certificate_path=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--)
			shift
			continue
			;;
		--copy)
			copy_to_clipboard=true
			shift
			;;
		--output)
			if [[ $# -lt 2 ]]; then
				echo "Missing value for --output" >&2
				usage >&2
				exit 1
			fi
			output_path="$2"
			shift 2
			;;
		--help|-h)
			usage
			exit 0
			;;
		--*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
		*)
			if [[ -n "$certificate_path" ]]; then
				echo "Only one .p12 path may be provided" >&2
				usage >&2
				exit 1
			fi
			certificate_path="$1"
			shift
			;;
	esac
done

if [[ -z "$certificate_path" ]]; then
	usage >&2
	exit 1
fi

if [[ ! -f "$certificate_path" ]]; then
	echo "Certificate file not found: $certificate_path" >&2
	exit 1
fi

encoded_value="$(base64 < "$certificate_path" | tr -d '\n')"

encoded_file="$(mktemp)"
decoded_file="$(mktemp)"
cleanup() {
	rm -f "$encoded_file" "$decoded_file"
}
trap cleanup EXIT

printf '%s' "$encoded_value" > "$encoded_file"

if ! decode_base64 "$encoded_file" "$decoded_file"; then
	echo "Failed to decode generated base64 output for verification" >&2
	exit 1
fi

if ! cmp -s "$certificate_path" "$decoded_file"; then
	echo "Decoded certificate does not match the original .p12 file" >&2
	exit 1
fi

if [[ -n "$output_path" ]]; then
	printf '%s\n' "$encoded_value" > "$output_path"
	printf 'Wrote APPLE_CERTIFICATE value to %s\n' "$output_path" >&2
fi

if [[ "$copy_to_clipboard" == true ]]; then
	if ! command -v pbcopy >/dev/null 2>&1; then
		echo "pbcopy is not available on this machine" >&2
		exit 1
	fi
	printf '%s' "$encoded_value" | pbcopy
	echo "Copied APPLE_CERTIFICATE value to the clipboard" >&2
fi

if [[ -z "$output_path" && "$copy_to_clipboard" == false ]]; then
	printf '%s\n' "$encoded_value"
fi

cat >&2 <<EOF
Verified base64 output for:
  $certificate_path

GitHub configuration:
  Secret APPLE_CERTIFICATE = the generated base64 value
  Secret APPLE_CERTIFICATE_PASSWORD = the .p12 export password you chose in Keychain Access
EOF