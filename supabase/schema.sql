-- ============================================================================
-- ENDOMONDO NEO — SUPABASE + POSTGIS CLOUD SCHEMA
-- Soporta: Rutas 3D (Lat/Lon/Alt), Laps, Récords Personales, Retos y Peptalks
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Perfiles de Usuario y Configuración Biométrica
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    weight_kg NUMERIC(5,2) DEFAULT 72.0,
    height_cm INTEGER DEFAULT 175,
    resting_hr INTEGER DEFAULT 58,
    max_hr INTEGER DEFAULT 190,
    ftp_watts INTEGER DEFAULT 240,
    audio_coach_enabled BOOLEAN DEFAULT TRUE,
    auto_pause_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Entrenamientos (Workouts) con Geometría PostGIS 3D
CREATE TABLE IF NOT EXISTS public.workouts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sport_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('live', 'paused', 'completed')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_active_sec INTEGER NOT NULL DEFAULT 0,
    duration_total_sec INTEGER NOT NULL DEFAULT 0,
    distance_meters NUMERIC(10,2) NOT NULL DEFAULT 0,
    avg_pace_sec_per_km NUMERIC(8,2),
    avg_speed_kmh NUMERIC(6,2),
    max_speed_kmh NUMERIC(6,2),
    elevation_gain_m NUMERIC(8,2) DEFAULT 0,
    elevation_loss_m NUMERIC(8,2) DEFAULT 0,
    calories_kcal INTEGER DEFAULT 0,
    avg_hr_bpm INTEGER,
    max_hr_bpm INTEGER,
    avg_cadence_spm INTEGER,
    avg_power_watts INTEGER,
    -- Geometría 3D PostGIS (Longitud, Latitud, Altitud)
    route_geom GEOMETRY(LINESTRINGZ, 4326),
    -- Posición en vivo para amigos siguiendo el entrenamiento
    last_live_location GEOMETRY(POINTZ, 4326),
    hydration_ml INTEGER DEFAULT 0,
    notes TEXT,
    weather_temp_c NUMERIC(4,1),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_started ON public.workouts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_route_gist ON public.workouts USING GIST (route_geom);

-- 3. Vueltas / Parciales por Kilómetro (Workout Laps)
CREATE TABLE IF NOT EXISTS public.workout_laps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
    lap_number INTEGER NOT NULL,
    distance_meters NUMERIC(8,2) NOT NULL,
    duration_sec NUMERIC(8,2) NOT NULL,
    pace_sec_per_km NUMERIC(8,2) NOT NULL,
    elevation_delta_m NUMERIC(7,2) DEFAULT 0,
    avg_hr_bpm INTEGER,
    avg_cadence_spm INTEGER,
    split_timestamp TIMESTAMPTZ NOT NULL,
    UNIQUE(workout_id, lap_number)
);

-- 4. Peptalks en Vivo (Mensajes de ánimo que el Audio Coach lee al instante)
CREATE TABLE IF NOT EXISTS public.peptalks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
    author_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) <= 240),
    delivered_to_audio_coach BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Supabase Realtime para workouts en vivo y peptalks instantáneos
ALTER PUBLICATION supabase_realtime ADD TABLE public.workouts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.peptalks;

-- 5. Récords Personales (Personal Bests: 1K, 1 Milla, 5K, 10K, Media Maratón, Maratón)
CREATE TABLE IF NOT EXISTS public.personal_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sport_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('1k', '1mi', '3k', '5k', '10k', 'half_marathon', 'marathon', 'max_distance', 'max_elevation')),
    value_numeric NUMERIC(10,2) NOT NULL, -- Segundos para distancias fijas o metros para max_distance
    workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
    achieved_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, sport_id, category)
);

-- 6. Retos Clásicos de Endomondo (Challenges)
CREATE TABLE IF NOT EXISTS public.challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    sport_id TEXT NOT NULL,
    goal_type TEXT NOT NULL CHECK (goal_type IN ('total_distance_km', 'total_calories', 'total_duration_min', 'most_workouts')),
    target_value NUMERIC(10,2),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES public.profiles(id)
);
