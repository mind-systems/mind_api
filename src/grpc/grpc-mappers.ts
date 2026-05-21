import type { UserDto } from '../../proto/generated/auth';
import type { UserResponseDto } from '../users/dto/auth-response.dto';
import type { BciDevice as BciDeviceProto } from '../../proto/generated/bci_devices';
import type { BciDevice } from '../bci/entities/bci-device.entity';
import { UserRole } from '../users/interfaces/user-role.enum';
import {
  StepType,
  TimeOfDay as ProtoTimeOfDay,
} from '../../proto/generated/breath_sessions';
import type {
  BreathSessionDto,
  BreathSessionWithStarredDto,
  ExerciseDto as ExerciseDtoProto,
} from '../../proto/generated/breath_sessions';
import type {
  BreathExercise,
  BreathSession,
} from '../breath-sessions/entities/breath-session.entity';
import { TimeOfDay } from '../breath-sessions/enums/time-of-day.enum';

export function toProtoUserRole(role: UserRole): number {
  switch (role) {
    case UserRole.ADMIN:
      return 1;
    case UserRole.USER:
    default:
      return 0;
  }
}

export function toProtoUserDto(dto: UserResponseDto): UserDto {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    role: toProtoUserRole(dto.role),
    language: dto.language,
  };
}

export function toProtoStepType(type: 'inhale' | 'exhale' | 'hold'): StepType {
  switch (type) {
    case 'inhale':
      return StepType.INHALE;
    case 'exhale':
      return StepType.EXHALE;
    case 'hold':
      return StepType.HOLD;
  }
}

export function toProtoTimeOfDay(
  tod: TimeOfDay | null,
): ProtoTimeOfDay | undefined {
  if (tod === null) return undefined;
  switch (tod) {
    case TimeOfDay.MORNING:
      return ProtoTimeOfDay.MORNING;
    case TimeOfDay.MIDDAY:
      return ProtoTimeOfDay.MIDDAY;
    case TimeOfDay.EVENING:
      return ProtoTimeOfDay.EVENING;
  }
}

export function fromProtoTimeOfDay(tod: ProtoTimeOfDay): TimeOfDay {
  switch (tod) {
    case ProtoTimeOfDay.MORNING:
      return TimeOfDay.MORNING;
    case ProtoTimeOfDay.MIDDAY:
      return TimeOfDay.MIDDAY;
    case ProtoTimeOfDay.EVENING:
      return TimeOfDay.EVENING;
    default:
      throw new Error(`Unknown TimeOfDay value: ${tod}`);
  }
}

export function toProtoExerciseDto(exercise: BreathExercise): ExerciseDtoProto {
  return {
    steps: exercise.steps.map((s) => ({
      type: toProtoStepType(s.type),
      duration: s.duration,
    })),
    restDuration: exercise.restDuration,
    repeatCount: exercise.repeatCount,
  };
}

export function toProtoBreathSessionDto(
  session: BreathSession,
): BreathSessionDto {
  return {
    id: session.id,
    userId: session.userId,
    description: session.description,
    exercises: session.exercises.map(toProtoExerciseDto),
    complexity: session.complexity,
    shared: session.shared,
    timeOfDay: toProtoTimeOfDay(session.timeOfDay),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    deletedAt: session.deletedAt ? session.deletedAt.toISOString() : undefined,
  };
}

export function toProtoBreathSessionWithStarredDto(
  session: BreathSession & { isStarred?: boolean },
): BreathSessionWithStarredDto {
  return {
    session: toProtoBreathSessionDto(session),
    isStarred: session.isStarred,
  };
}

function fromProtoStepType(type: StepType): 'inhale' | 'exhale' | 'hold' {
  switch (type) {
    case StepType.INHALE:
      return 'inhale';
    case StepType.EXHALE:
      return 'exhale';
    case StepType.HOLD:
      return 'hold';
    default:
      throw new Error(`Unknown StepType value: ${type}`);
  }
}

export function fromProtoExercises(
  exercises: ExerciseDtoProto[],
): BreathExercise[] {
  return exercises.map((e) => ({
    steps: e.steps.map((s) => ({
      type: fromProtoStepType(s.type),
      duration: s.duration,
    })),
    restDuration: e.restDuration,
    repeatCount: e.repeatCount,
  }));
}

export function toProtoBciDevice(entity: BciDevice): BciDeviceProto {
  return {
    id: entity.id,
    serial: entity.serial,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
