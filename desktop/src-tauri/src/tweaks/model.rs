//! Datenmodell der Tweaks: feste IDs, Metadaten, Zustände und Fehler.
//! Das Fenster kennt nur diese IDs – Registry-Pfade stehen ausschließlich hier im Backend.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TweakId {
    MouseAcceleration,
    KeyboardRepeat,
    KeyboardFilterkeys,
    KeyboardQueue,
    MouseQueue,
    MmcssGames,
    UsbPolling,
    FivemRawInput,
}

impl TweakId {
    pub const ALL: [TweakId; 8] = [
        TweakId::MouseAcceleration,
        TweakId::KeyboardRepeat,
        TweakId::KeyboardFilterkeys,
        TweakId::KeyboardQueue,
        TweakId::MouseQueue,
        TweakId::MmcssGames,
        TweakId::UsbPolling,
        TweakId::FivemRawInput,
    ];

    /// Was der Haupt-Toggle „WASD Tweak“ anwendet: nur risikoarme Benutzereinstellungen.
    pub const PROFILE: [TweakId; 2] = [TweakId::MouseAcceleration, TweakId::KeyboardRepeat];

    pub fn as_str(self) -> &'static str {
        match self {
            TweakId::MouseAcceleration => "mouse_acceleration",
            TweakId::KeyboardRepeat => "keyboard_repeat",
            TweakId::KeyboardFilterkeys => "keyboard_filterkeys",
            TweakId::KeyboardQueue => "keyboard_queue",
            TweakId::MouseQueue => "mouse_queue",
            TweakId::MmcssGames => "mmcss_games",
            TweakId::UsbPolling => "usb_polling",
            TweakId::FivemRawInput => "fivem_raw_input",
        }
    }

    pub fn parse(text: &str) -> Option<TweakId> {
        TweakId::ALL.into_iter().find(|id| id.as_str() == text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Mouse,
    Keyboard,
    System,
    Fivem,
}

/// Was die App mit dem Eintrag tun kann.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Umschaltbare, risikoarme Einstellung.
    Toggle,
    /// Umschaltbar, aber nur auf ausdrücklichen Wunsch (nie über den Haupt-Toggle).
    Experimental,
    /// Nur Anzeige und Erklärung.
    Diagnostic,
    /// Lässt sich nur im Spiel selbst einstellen.
    InGame,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Risk {
    None,
    Low,
    Medium,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: TweakId,
    pub name: &'static str,
    pub description: &'static str,
    pub category: Category,
    pub kind: Kind,
    pub risk: Risk,
    pub recommended: bool,
    pub needs_admin: bool,
    pub needs_restart: bool,
    pub experimental: bool,
    /// Wird vom Haupt-Toggle mit angewendet.
    pub in_profile: bool,
    /// „Benutzung auf eigene Gefahr“: Einschalten nur nach ausdrücklicher Bestätigung.
    pub own_risk: bool,
    /// Text der Warnung, die vor dem Einschalten bestätigt werden muss.
    pub risk_notice: Option<&'static str>,
}

pub fn meta(id: TweakId) -> Meta {
    let base = |name, description, category, kind, risk| Meta {
        id,
        name,
        description,
        category,
        kind,
        risk,
        recommended: false,
        needs_admin: false,
        needs_restart: false,
        experimental: kind == Kind::Experimental,
        in_profile: TweakId::PROFILE.contains(&id),
        own_risk: false,
        risk_notice: None,
    };
    match id {
        TweakId::MouseAcceleration => Meta {
            recommended: true,
            ..base(
                "Mausbeschleunigung",
                "Schaltet die Windows-Zeigerbeschleunigung („Zeigerpräzision verbessern“) aus. Gleiche Handbewegung = gleiche Zeigerstrecke – in allen Programmen, die den Windows-Zeiger nutzen.",
                Category::Mouse,
                Kind::Toggle,
                Risk::Low,
            )
        },
        TweakId::KeyboardRepeat => Meta {
            recommended: true,
            ..base(
                "Tastenwiederholung",
                "Schnellste Wiederholrate (31) und kürzeste Verzögerung (0) für gehaltene Tasten. Ändert nicht, wie schnell der erste Tastendruck ankommt.",
                Category::Keyboard,
                Kind::Toggle,
                Risk::Low,
            )
        },
        TweakId::KeyboardFilterkeys => Meta {
            own_risk: true,
            risk_notice: Some(
                "FilterKeys ist eine Windows-Bedienhilfe. Wer sie wegen zitternder Hände oder ungewollter Doppelanschläge braucht, sollte sie nicht ausschalten. Die App schaltet sie und ihr Tastenkürzel aus; „Originalwerte wiederherstellen“ stellt beides zurück.",
            ),
            ..base(
            "Anschlagverzögerung (FilterKeys)",
            "Windows-Bedienhilfe, die kurze oder wiederholte Anschläge ignorieren kann. Die App schaltet sie und ihre Tastenkombination (rechte Umschalttaste 8 s halten) aus.",
            Category::Keyboard,
            Kind::Toggle,
            Risk::Low,
        )
        },
        TweakId::KeyboardQueue => base(
            "Tastatur-Puffer",
            "Größe des Eingabepuffers im Tastaturtreiber (KeyboardDataQueueSize). Ein Puffer, kein Geschwindigkeitsregler.",
            Category::Keyboard,
            Kind::Diagnostic,
            Risk::None,
        ),
        TweakId::MouseQueue => base(
            "Maus-Puffer",
            "Größe des Eingabepuffers im Maustreiber (MouseDataQueueSize). Kleiner heißt nicht schneller.",
            Category::Mouse,
            Kind::Diagnostic,
            Risk::None,
        ),
        TweakId::MmcssGames => Meta {
            needs_admin: true,
            needs_restart: true,
            own_risk: true,
            risk_notice: Some(
                "Ändert eine systemweite Windows-Einstellung (HKEY_LOCAL_MACHINE) für alle Programme, die den MMCSS-Task „Games“ nutzen. Eine Verbesserung für FiveM ist nicht belegt; im schlechtesten Fall bekommen andere Programme weniger Rechenzeit. Wirksam nach einem Neustart. Benutzung auf eigene Gefahr.",
            ),
            ..base(
                "MMCSS „Games“",
                "Setzt die Scheduling Category des Games-Tasks im Multimedia Class Scheduler auf „High“. Wirkt nur auf Threads, die sich selbst für „Games“ anmelden – ob FiveM das tut, ist nicht dokumentiert.",
                Category::System,
                Kind::Experimental,
                Risk::Medium,
            )
        },
        TweakId::UsbPolling => base(
            "USB-Polling",
            "Zeigt Mäuse und Tastaturen an und misst die tatsächliche Abfragerate. Ändern lässt sie sich nur in der Software des Herstellers.",
            Category::System,
            Kind::Diagnostic,
            Risk::None,
        ),
        TweakId::FivemRawInput => base(
            "Raw Input in FiveM",
            "Die Maus-Eingabemethode stellt FiveM selbst ein (Einstellungen → Tastatur/Maus). Von außen lässt sie sich nicht sicher ändern.",
            Category::Fivem,
            Kind::InGame,
            Risk::None,
        ),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TweakState {
    Inactive,
    Active,
    PartiallyActive,
    Applying,
    Restoring,
    PendingRestart,
    Unsupported,
    Error,
    /// Reine Anzeige ohne Schalter.
    Diagnostic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// „Benutzung auf eigene Gefahr“ wurde nicht bestätigt.
    ConfirmationRequired,
    /// Nur mit Administratorrechten möglich.
    NeedsElevation,
    /// Der Nutzer hat die Rechteabfrage abgelehnt.
    ElevationDenied,
    Unsupported,
    InvalidValue,
    Backup,
    Os,
    Verify,
    Busy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakError {
    pub code: ErrorCode,
    pub message: String,
}

impl TweakError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn os(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Os, message)
    }
    pub fn backup(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Backup, message)
    }
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, message)
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidValue, message)
    }
    pub fn needs_elevation() -> Self {
        Self::new(ErrorCode::NeedsElevation, "Für diese Einstellung braucht die App Administratorrechte.")
    }
}

impl std::fmt::Display for TweakError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

pub type TweakResult<T> = Result<T, TweakError>;
