//! Nebulix native core: everything the native apps share that is not user interface.
pub mod api;
pub mod e2ee;
pub mod store;
pub mod ws;

pub use api::{ApiError, ApiResult, Client, Login};

/// The production server. Settings can point the app at another Nebulix server (self-hosted or a test one).
pub const DEFAULT_SERVER: &str = "https://nebulix.fly.dev";
