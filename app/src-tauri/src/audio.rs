use rodio::{OutputStream, Source};
use std::thread;
use std::time::Duration;

/// Types of sounds that can be played
#[derive(Debug, Clone, Copy)]
pub enum SoundType {
    RecordingStart,
    RecordingStop,
}

/// Play a sound effect (non-blocking)
pub fn play_sound(sound_type: SoundType) {
    // Spawn a thread to play sound without blocking
    thread::spawn(move || {
        if let Err(e) = play_sound_blocking(sound_type) {
            log::warn!("Failed to play sound: {}", e);
        }
    });
}

fn play_sound_blocking(sound_type: SoundType) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (_stream, stream_handle) = OutputStream::try_default()?;

    let (frequency, duration_ms) = match sound_type {
        SoundType::RecordingStart => (880.0, 100), // A5 note, short beep
        SoundType::RecordingStop => (440.0, 150),  // A4 note, slightly longer
    };

    let source = SineWave::new(frequency)
        .take_duration(Duration::from_millis(duration_ms))
        .amplify(0.3); // Reduce volume to 30%

    stream_handle.play_raw(source.convert_samples())?;

    // Wait for the sound to finish playing
    thread::sleep(Duration::from_millis(duration_ms + 50));

    Ok(())
}

/// A simple sine wave source for generating beep tones
struct SineWave {
    frequency: f32,
    sample_rate: u32,
    sample_index: u64,
}

impl SineWave {
    fn new(frequency: f32) -> Self {
        Self {
            frequency,
            sample_rate: 44100,
            sample_index: 0,
        }
    }
}

impl Iterator for SineWave {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let value = (2.0 * std::f32::consts::PI * self.frequency * self.sample_index as f32
            / self.sample_rate as f32)
            .sin();
        self.sample_index = self.sample_index.wrapping_add(1);
        Some(value)
    }
}

impl Source for SineWave {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        1
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}
