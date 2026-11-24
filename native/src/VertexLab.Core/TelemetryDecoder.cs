using System.Buffers.Binary;
namespace VertexLab.Core;
public static class TelemetryDecoder
{
    public static TelemetryPacket Decode(byte[] data)
    {
        if (data.Length != 324) throw new InvalidDataException($"Se esperaban 324 bytes, llegaron {data.Length}");
        double F(int offset) { var n = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(offset)); return float.IsFinite(n) ? n : throw new InvalidDataException("Telemetría no finita"); }
        int I(int offset) => BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(offset));
        double[] Four(int offset) => Enumerable.Range(0,4).Select(i=>F(offset+4*i)).ToArray();
        return new TelemetryPacket {
            Active=I(0)==1, Timestamp=BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(4)),
            X=F(244),Y=F(248),Z=F(252),Speed=F(256)*3.6,Distance=F(292),LapTime=F(304),RaceTime=F(308),
            Lap=BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(312)),RacePosition=data[314],
            CarOrdinal=I(212),CarClass=I(216),CarPI=I(220),Rpm=F(16),EngineMaxRpm=F(8),Gear=data[319],
            Steer=unchecked((sbyte)data[320]),AccelX=F(20),AccelY=F(24),AccelZ=F(28),
            TireTempsC=Four(268).Select(f=>(f-32)*5/9).ToArray(),TireSlipCombined=Four(180),TireSlipRatio=Four(84),Suspension=Four(68),
            Throttle=data[315]/255d*100,Brake=data[316]/255d*100
        };
    }
}
