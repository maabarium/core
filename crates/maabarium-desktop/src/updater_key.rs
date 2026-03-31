use base64::engine::general_purpose::STANDARD;
use base64::Engine;

pub(crate) fn normalize_updater_pubkey(raw_value: &str) -> Option<String> {
    let normalized = unwrap_base64_wrapped_minisign(raw_value);
    let lines = normalized
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if lines.is_empty() || lines.len() > 2 {
        return None;
    }

    if lines.len() == 2 && !lines[0].to_ascii_lowercase().starts_with("untrusted comment:") {
        return None;
    }

    let key_line = lines[lines.len() - 1];
    let comment_line = if lines.len() == 2 {
        lines[0]
    } else {
        "untrusted comment: minisign public key"
    };

    Some(STANDARD.encode(format!("{comment_line}\n{key_line}\n")))
}

fn unwrap_base64_wrapped_minisign(raw_value: &str) -> String {
    let normalized = raw_value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("\\n", "\n")
        .trim()
        .to_owned();

    if normalized.is_empty()
        || normalized.contains('\n')
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return normalized;
    }

    let Ok(decoded) = STANDARD.decode(normalized.as_bytes()) else {
        return normalized;
    };
    let Ok(decoded_text) = String::from_utf8(decoded) else {
        return normalized;
    };

    let decoded_normalized = decoded_text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("\\n", "\n")
        .trim()
        .to_owned();

    if decoded_normalized
        .to_ascii_lowercase()
        .starts_with("untrusted comment:")
    {
        decoded_normalized
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_updater_pubkey;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    #[test]
    fn normalizes_plain_two_line_pubkey() {
        let pubkey = normalize_updater_pubkey(
            "untrusted comment: minisign public key\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n",
        );

        let expected = STANDARD.encode(
            "untrusted comment: minisign public key\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n",
        );

        assert_eq!(
            pubkey.as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn normalizes_base64_wrapped_two_line_pubkey() {
        let wrapped =
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIzNzM1MzExODM4QzlDMzcKUldRM25JeURFVk56STN4Y1VscHBFVlBPVUp4aXFTTHhIOCtiWXBSOXA1YmdxQ09pekpkaDk4ZTMK";

        let pubkey = normalize_updater_pubkey(wrapped);

        assert_eq!(
            pubkey.as_deref(),
            Some(wrapped)
        );
    }

    #[test]
    fn wraps_raw_key_line_into_two_line_minisign_text() {
        let pubkey =
            normalize_updater_pubkey("RWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3");

        let expected = STANDARD.encode(
            "untrusted comment: minisign public key\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n",
        );

        assert_eq!(
            pubkey.as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn rejects_invalid_two_line_material() {
        let pubkey = normalize_updater_pubkey("not a minisign header\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n");

        assert!(pubkey.is_none());
    }
}