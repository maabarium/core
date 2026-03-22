use secrecy::SecretString;

use crate::error::SecretError;

const SERVICE_NAME: &str = "maabarium";

pub trait ApiKeyStore {
    fn set_api_key(&self, provider: &str, api_key: SecretString) -> Result<(), SecretError>;
    fn get_api_key(&self, provider: &str) -> Result<Option<SecretString>, SecretError>;
    fn delete_api_key(&self, provider: &str) -> Result<bool, SecretError>;
}

pub struct SecretStore {
    service_name: &'static str,
}

impl Default for SecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore {
    pub fn new() -> Self {
        Self {
            service_name: SERVICE_NAME,
        }
    }

    pub fn resolve_api_key(
        &self,
        provider: &str,
        env_var: Option<&str>,
    ) -> Result<Option<SecretString>, SecretError> {
        if let Some(name) = env_var.map(str::trim).filter(|value| !value.is_empty()) {
            if let Ok(secret) = std::env::var(name) {
                if !secret.trim().is_empty() {
                    return Ok(Some(SecretString::from(secret)));
                }
            }
        }

        self.get_api_key(provider)
    }
}

impl ApiKeyStore for SecretStore {
    fn set_api_key(&self, provider: &str, api_key: SecretString) -> Result<(), SecretError> {
        let provider = normalize_provider(provider)?;
        let entry = keyring::Entry::new(self.service_name, provider.as_str())?;
        entry.set_password(api_key.expose_secret())?;
        Ok(())
    }

    fn get_api_key(&self, provider: &str) -> Result<Option<SecretString>, SecretError> {
        let provider = normalize_provider(provider)?;
        let entry = keyring::Entry::new(self.service_name, provider.as_str())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(SecretString::from(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn delete_api_key(&self, provider: &str) -> Result<bool, SecretError> {
        let provider = normalize_provider(provider)?;
        let entry = keyring::Entry::new(self.service_name, provider.as_str())?;
        match entry.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
}

fn normalize_provider(provider: &str) -> Result<String, SecretError> {
    let normalized = provider.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(SecretError::InvalidInput(
            "provider cannot be empty".to_owned(),
        ));
    }
    Ok(normalized)
}

trait SecretExposeExt {
    fn expose_secret(&self) -> &str;
}

impl SecretExposeExt for SecretString {
    fn expose_secret(&self) -> &str {
        secrecy::ExposeSecret::expose_secret(self)
    }
}
